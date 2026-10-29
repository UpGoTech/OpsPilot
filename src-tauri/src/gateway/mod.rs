use crate::connection::ConnectionConfig;
use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GatewayState {
    Idle,
    Connecting,
    Open,
    Closed,
    Error,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStateEvent {
    pub state: GatewayState,
    pub detail: Option<String>,
}

enum Command {
    Rpc {
        method: String,
        params: Value,
        respond: oneshot::Sender<Result<Value, String>>,
    },
    Close,
}

pub struct GatewayManager {
    inner: Mutex<Option<GatewaySession>>,
}

struct GatewaySession {
    cmd_tx: mpsc::UnboundedSender<Command>,
}

impl GatewayManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    pub fn state_idle(app: &AppHandle) {
        let _ = app.emit(
            "gateway-state",
            GatewayStateEvent {
                state: GatewayState::Idle,
                detail: None,
            },
        );
    }

    pub async fn connect(
        self: &Arc<Self>,
        app: AppHandle,
        config: ConnectionConfig,
    ) -> Result<(), String> {
        self.disconnect().await;

        let _ = app.emit(
            "gateway-state",
            GatewayStateEvent {
                state: GatewayState::Connecting,
                detail: None,
            },
        );

        // Desktop remints a single-use ?ticket= before every dial for cookie sessions.
        let ws_url = crate::auth::resolve_ws_url(&config)
            .await
            .map_err(|e| e.to_string())?;

        let mut request = ws_url
            .as_str()
            .into_client_request()
            .map_err(|e| format!("Invalid WebSocket URL: {e}"))?;
        {
            let headers = request.headers_mut();
            for (name, value) in config.filtered_extra_headers() {
                if let (Ok(n), Ok(v)) = (
                    name.parse::<tokio_tungstenite::tungstenite::http::header::HeaderName>(),
                    value.parse::<tokio_tungstenite::tungstenite::http::HeaderValue>(),
                ) {
                    headers.insert(n, v);
                }
            }
        }

        let (ws, _) = connect_async(request)
            .await
            .map_err(|e| format!("WebSocket connect failed: {e}"))?;

        let (mut write, mut read) = ws.split();
        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<Command>();
        let pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        {
            let mut guard = self.inner.lock();
            *guard = Some(GatewaySession {
                cmd_tx: cmd_tx.clone(),
            });
        }

        // Stay in Connecting until the first `gateway.ready` event — Desktop
        // does not treat the raw WS open as a usable gateway.
        let pending_writer = pending.clone();
        let writer = tauri::async_runtime::spawn(async move {
            while let Some(cmd) = cmd_rx.recv().await {
                match cmd {
                    Command::Close => break,
                    Command::Rpc {
                        method,
                        params,
                        respond,
                    } => {
                        let id = format!("r{}", next_request_id());
                        let frame = json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "method": method,
                            "params": params,
                        });
                        pending_writer.lock().insert(id, respond);
                        let payload = format!("{frame}\n");
                        if let Err(e) = write.send(Message::Text(payload.into())).await {
                            let mut map = pending_writer.lock();
                            for (_, tx) in map.drain() {
                                let _ = tx.send(Err(format!("WebSocket send failed: {e}")));
                            }
                            break;
                        }
                    }
                }
            }
            let _ = write.close().await;
        });

        let app_reader = app.clone();
        let pending_reader = pending.clone();
        let manager = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut buffer = String::new();
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        buffer.push_str(&text);
                        while let Some(idx) = buffer.find('\n') {
                            let line = buffer[..idx].trim().to_string();
                            buffer.drain(..=idx);
                            if line.is_empty() {
                                continue;
                            }
                            handle_frame(&app_reader, &pending_reader, &line);
                        }
                        // Also accept a complete JSON object without trailing newline
                        if !buffer.trim().is_empty() {
                            let trimmed = buffer.trim().to_string();
                            if trimmed.starts_with('{') && trimmed.ends_with('}') {
                                handle_frame(&app_reader, &pending_reader, &trimmed);
                                buffer.clear();
                            }
                        }
                    }
                    Ok(Message::Ping(_)) | Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {}
                    Ok(Message::Binary(_)) => {}
                    Ok(Message::Close(_)) | Err(_) => break,
                }
            }

            {
                let mut map = pending_reader.lock();
                for (_, tx) in map.drain() {
                    let _ = tx.send(Err("gateway connection closed".into()));
                }
            }
            {
                let mut guard = manager.inner.lock();
                *guard = None;
            }
            let _ = writer.await;
            let _ = app_reader.emit(
                "gateway-state",
                GatewayStateEvent {
                    state: GatewayState::Closed,
                    detail: Some("Connection closed".into()),
                },
            );
        });

        Ok(())
    }

    pub async fn disconnect(&self) {
        let session = {
            let mut guard = self.inner.lock();
            guard.take()
        };
        if let Some(session) = session {
            let _ = session.cmd_tx.send(Command::Close);
        }
    }

    pub async fn rpc(&self, method: String, params: Value) -> Result<Value, String> {
        let tx = {
            let guard = self.inner.lock();
            guard
                .as_ref()
                .map(|s| s.cmd_tx.clone())
                .ok_or_else(|| "gateway not connected".to_string())?
        };
        let (respond_tx, respond_rx) = oneshot::channel();
        tx.send(Command::Rpc {
            method,
            params,
            respond: respond_tx,
        })
        .map_err(|_| "gateway not connected".to_string())?;

        match tokio::time::timeout(std::time::Duration::from_secs(120), respond_rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("gateway response channel closed".into()),
            Err(_) => Err("gateway request timed out".into()),
        }
    }
}

fn next_request_id() -> u64 {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    COUNTER.fetch_add(1, Ordering::Relaxed)
}

fn handle_frame(
    app: &AppHandle,
    pending: &Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>,
    line: &str,
) {
    let Ok(frame) = serde_json::from_str::<Value>(line) else {
        return;
    };

    if let Some(id) = frame.get("id").filter(|v| !v.is_null()) {
        let key = match id {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            other => other.to_string(),
        };
        if let Some(tx) = pending.lock().remove(&key) {
            if let Some(err) = frame.get("error") {
                let message = err
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("RPC error")
                    .to_string();
                let code = err.get("code").map(|c| c.to_string()).unwrap_or_default();
                let data = err
                    .get("data")
                    .map(|d| d.to_string())
                    .unwrap_or_default();
                let detail = match (code.as_str(), data.as_str()) {
                    ("", "") => message,
                    (c, "") => format!("{message} (code {c})"),
                    ("", d) => format!("{message}: {d}"),
                    (c, d) => format!("{message} (code {c}): {d}"),
                };
                let _ = tx.send(Err(detail));
            } else {
                let result = frame.get("result").cloned().unwrap_or(Value::Null);
                let _ = tx.send(Ok(result));
            }
        }
        return;
    }

    // Hermes notifications: {"method":"event","params":{"type":"gateway.ready",...}}
    // Desktop passes `params` through as the GatewayEvent unchanged.
    if frame.get("method").and_then(|m| m.as_str()) == Some("event") {
        let params = frame.get("params").cloned().unwrap_or(Value::Null);
        let event_type = params
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("event");

        if event_type == "gateway.ready" {
            let _ = app.emit(
                "gateway-state",
                GatewayStateEvent {
                    state: GatewayState::Open,
                    detail: None,
                },
            );
        }

        let event = json!({
            "type": event_type,
            "session_id": params.get("session_id").cloned().unwrap_or(Value::Null),
            "payload": params.get("payload").cloned().unwrap_or(Value::Null),
            "seq": params.get("seq").cloned().unwrap_or(Value::Null),
        });
        let _ = app.emit("gateway-event", event);
        return;
    }

    // Fallback: method name is the event type (older/alternate frames).
    if let Some(method) = frame.get("method").and_then(|m| m.as_str()) {
        let params = frame.get("params").cloned().unwrap_or(Value::Null);
        let event = json!({
            "type": method,
            "session_id": params.get("session_id").cloned().unwrap_or(Value::Null),
            "payload": params,
        });
        let _ = app.emit("gateway-event", event);
    }
}
