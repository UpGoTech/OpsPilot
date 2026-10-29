<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { Button, FormControl } from "frappe-ui";
import { useGatewayStore } from "../stores/gateway";
import { useSessionsStore } from "../stores/sessions";
import { useChatStore } from "../stores/chat";
import type { AuthMode } from "../types";

interface HeaderRow {
  id: string;
  name: string;
  value: string;
}

const props = withDefaults(
  defineProps<{
    /** When true, drop page chrome that the shell already provides. */
    embedded?: boolean;
  }>(),
  { embedded: false },
);

const gateway = useGatewayStore();
const sessions = useSessionsStore();
const chat = useChatStore();

const form = reactive({
  name: "",
  url: "",
  token: "",
  username: "",
  password: "",
  authMode: "password" as AuthMode,
});
const headers = ref<HeaderRow[]>([]);
const probing = ref(false);
const saving = ref(false);
const connecting = ref(false);
const message = ref<string | null>(null);
const messageTone = ref<"ok" | "err">("ok");
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let authTouched = false;

const providerLabel = computed(() => {
  const providers = gateway.authProbe?.providers ?? [];
  if (!providers.length) return "username and password";
  return providers.map((p) => p.displayName || p.name).join(" / ");
});

const isSignIn = computed(() => form.authMode === "password");
const isToken = computed(() => form.authMode === "token");

watch(
  () => gateway.connection,
  (value) => {
    form.name = value.name ?? "";
    form.url = value.url ?? "";
    form.token = value.token ?? "";
    form.username = value.username ?? "";
    form.authMode =
      value.authMode === "token" || value.authMode === "password"
        ? value.authMode
        : "password";
    headers.value = Object.entries(value.extraHeaders ?? {}).map(([name, headerValue]) => ({
      id: crypto.randomUUID(),
      name,
      value: headerValue,
    }));
  },
  { immediate: true, deep: true },
);

watch(
  () => form.url,
  (url) => {
    if (probeTimer) clearTimeout(probeTimer);
    if (!url.trim()) return;
    probeTimer = setTimeout(() => {
      void runProbe();
    }, 450);
  },
);

function setMessage(text: string, tone: "ok" | "err") {
  message.value = text;
  messageTone.value = tone;
}

function setAuthMode(mode: AuthMode) {
  authTouched = true;
  form.authMode = mode;
}

function headersObject() {
  const out: Record<string, string> = {};
  for (const row of headers.value) {
    const name = row.name.trim();
    if (!name) continue;
    out[name] = row.value;
  }
  return out;
}

function currentConfig() {
  return {
    name: form.name.trim(),
    url: form.url.trim(),
    token: form.token.trim(),
    username: form.username.trim(),
    password: form.password,
    authMode: form.authMode,
    cookies: gateway.connection.cookies ?? {},
    extraHeaders: headersObject(),
  };
}

function addHeader() {
  headers.value.push({ id: crypto.randomUUID(), name: "", value: "" });
}

function removeHeader(id: string) {
  headers.value = headers.value.filter((row) => row.id !== id);
}

async function runProbe() {
  if (!form.url.trim()) return;
  probing.value = true;
  try {
    const probe = await gateway.probe(currentConfig(), authTouched);
    if (probe.normalizedUrl) form.url = probe.normalizedUrl;
    if (!authTouched) {
      form.authMode = probe.authMode === "token" ? "token" : "password";
    }
    if (probe.authRequired && isSignIn.value) {
      setMessage(
        probe.signedIn
          ? `Detected ${providerLabel.value}. Session is saved — you can connect.`
          : `Detected ${providerLabel.value}. Use Sign in below.`,
        "ok",
      );
    }
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "err");
  } finally {
    probing.value = false;
  }
}

function onCancel() {
  const value = gateway.connection;
  form.name = value.name ?? "";
  form.url = value.url ?? "";
  form.token = value.token ?? "";
  form.username = value.username ?? "";
  form.password = "";
  form.authMode =
    value.authMode === "token" || value.authMode === "password"
      ? value.authMode
      : "password";
  headers.value = Object.entries(value.extraHeaders ?? {}).map(([name, headerValue]) => ({
    id: crypto.randomUUID(),
    name,
    value: headerValue,
  }));
  message.value = null;
  authTouched = false;
}

async function onSaveConnection() {
  saving.value = true;
  message.value = null;
  try {
    const { password: _password, ...config } = currentConfig();
    await gateway.save(config);
    setMessage("Connection saved.", "ok");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "err");
  } finally {
    saving.value = false;
  }
}

async function onConnect() {
  connecting.value = true;
  message.value = null;
  try {
    let config = currentConfig();
    if (isSignIn.value) {
      if (!gateway.isSignedIn) {
        if (!form.username.trim() || !form.password) {
          throw new Error("Username and password are required to sign in");
        }
        config = await gateway.signIn(config);
        form.password = "";
      }
      await gateway.save({ ...config, password: "" });
    } else {
      if (!form.token.trim() && !gateway.connection.token?.trim()) {
        throw new Error("Session token is required");
      }
      await gateway.save({ ...config, password: "" });
    }

    await gateway.connect({
      ...gateway.connection,
      ...config,
      password: "",
      token: config.token || gateway.connection.token || "",
      cookies: gateway.connection.cookies ?? config.cookies,
    });
    chat.ensureListener();
    for (let i = 0; i < 40 && !gateway.isConnected; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (gateway.isConnected) {
      await sessions.refresh();
    }
    setMessage("Connected to Hermes gateway.", "ok");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "err");
  } finally {
    connecting.value = false;
  }
}

async function onDisconnect() {
  await gateway.disconnect();
  setMessage("Disconnected.", "ok");
}
</script>

<template>
  <div
    class="h-full overflow-y-auto bg-white"
    :class="props.embedded ? 'px-6 py-5' : 'px-8 py-8'"
  >
    <div class="mx-auto max-w-xl">
      <template v-if="!props.embedded">
        <div
          class="mb-1 text-xs font-medium uppercase tracking-wide text-ink-gray-5"
        >
          Gateways
        </div>
        <h1 class="text-xl font-semibold text-ink-gray-9">Save connection</h1>
      </template>
      <template v-else>
        <div class="text-base font-semibold text-ink-gray-9">
          Remote gateway
        </div>
      </template>
      <p class="mt-1 text-sm text-ink-gray-5">
        A single Hermes gateway reachable over HTTP(S) — LAN, Tailscale, or the
        internet. Same fields as Hermes Desktop remote mode.
      </p>

      <div
        v-if="!props.embedded"
        class="mt-6 inline-flex rounded-md bg-surface-gray-2 p-0.5 text-sm"
      >
        <span
          class="rounded-[5px] bg-blue-500 px-3 py-1.5 font-medium text-white"
        >
          Remote gateway
        </span>
      </div>

      <div class="mt-6 space-y-5">
        <div>
          <FormControl
            v-model="form.name"
            type="text"
            label="Name"
            placeholder="Homelab"
          />
          <p class="mt-1.5 text-xs text-ink-gray-5">
            Optional label shown in the app (e.g. Homelab, Work VPS).
          </p>
        </div>

        <div>
          <FormControl
            v-model="form.url"
            type="url"
            label="Gateway URL"
            placeholder="http://homelab.lan:9119"
          />
          <p class="mt-1.5 text-xs text-ink-gray-5">
            Base URL only — not <code>/login</code>.
            <span v-if="probing"> Detecting auth…</span>
          </p>
        </div>

        <div>
          <div class="mb-1.5 text-sm font-medium text-ink-gray-8">Authentication</div>
          <div class="inline-flex rounded-md bg-surface-gray-2 p-0.5">
            <button
              type="button"
              class="rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors"
              :class="
                isToken
                  ? 'bg-blue-500 text-white'
                  : 'text-ink-gray-7 hover:text-ink-gray-9'
              "
              @click="setAuthMode('token')"
            >
              Session token
            </button>
            <button
              type="button"
              class="rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors"
              :class="
                isSignIn
                  ? 'bg-blue-500 text-white'
                  : 'text-ink-gray-7 hover:text-ink-gray-9'
              "
              @click="setAuthMode('password')"
            >
              Sign in
            </button>
          </div>
        </div>

        <div v-if="isToken">
          <FormControl
            v-model="form.token"
            type="password"
            label="Session token"
            placeholder="Paste session token"
          />
          <p class="mt-1.5 text-xs text-ink-gray-5">
            The dashboard session token used for REST and WebSocket access. Leave
            blank to keep the saved token.
          </p>
        </div>

        <div v-else class="space-y-4">
          <FormControl
            v-model="form.username"
            type="text"
            label="Username"
            placeholder="admin"
            autocomplete="username"
          />
          <FormControl
            v-model="form.password"
            type="password"
            label="Password"
            placeholder="••••••••"
            autocomplete="current-password"
          />
          <p class="text-xs text-ink-gray-5">
            Signs in through the gateway’s password form (same as Desktop Sign in).
            Leave password blank if a session cookie is already saved.
          </p>
          <p v-if="gateway.isSignedIn" class="text-sm text-ink-green-3">
            Signed in — session cookie is saved.
          </p>
        </div>

        <div>
          <div class="mb-1 text-sm font-medium text-ink-gray-8">
            Extra gateway headers
          </div>
          <p class="mb-3 text-xs text-ink-gray-5">
            Sent with every HTTP and WebSocket request — for access proxies such as
            Cloudflare Access (<code>CF-Access-Client-Id</code> /
            <code>CF-Access-Client-Secret</code>). Headers Hermes manages
            (Authorization, Cookie, Host…) are ignored.
          </p>
          <div class="space-y-2">
            <div
              v-for="row in headers"
              :key="row.id"
              class="flex items-start gap-2"
            >
              <FormControl
                v-model="row.name"
                type="text"
                class="min-w-0 flex-1"
                placeholder="Header name"
              />
              <FormControl
                v-model="row.value"
                type="password"
                class="min-w-0 flex-1"
                placeholder="Value"
              />
              <Button
                label="Remove"
                variant="ghost"
                size="sm"
                @click="removeHeader(row.id)"
              />
            </div>
          </div>
          <Button
            class="mt-2"
            label="Add header"
            variant="subtle"
            size="sm"
            icon-left="lucide-plus"
            @click="addHeader"
          />
        </div>

        <div
          v-if="message"
          class="text-sm"
          :class="messageTone === 'ok' ? 'text-ink-green-3' : 'text-ink-red-3'"
        >
          {{ message }}
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2 border-t border-outline-gray-1 pt-5">
          <Button
            label="Disconnect"
            variant="ghost"
            :disabled="!gateway.isConnected"
            @click="onDisconnect"
          />
          <Button label="Cancel" variant="ghost" @click="onCancel" />
          <Button
            label="Save connection"
            variant="subtle"
            :loading="saving"
            @click="onSaveConnection"
          />
          <Button
            :label="isSignIn && !gateway.isSignedIn ? 'Sign in & connect' : 'Connect'"
            variant="solid"
            theme="blue"
            :loading="connecting"
            @click="onConnect"
          />
        </div>
      </div>
    </div>
  </div>
</template>
