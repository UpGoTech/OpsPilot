<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Button, DesktopShell, FrappeUIProvider } from "frappe-ui";
import AgentPanel from "../../src/components/shell/AgentPanel.vue";
import AppTopBar from "../../src/components/shell/AppTopBar.vue";
import CenterWorkspace from "../../src/components/shell/CenterWorkspace.vue";
import ConnectingView from "../../src/views/ConnectingView.vue";
import LoginView from "../../src/views/LoginView.vue";
import SettingsView from "../../src/views/SettingsView.vue";
import { useCenterTabsStore } from "../../src/stores/centerTabs";
import { useChatStore } from "../../src/stores/chat";
import { useErpnextStore } from "../../src/stores/erpnext";
import { useGatewayStore } from "../../src/stores/gateway";
import { useLayoutStore } from "../../src/stores/layout";
import { useSessionsStore } from "../../src/stores/sessions";
import { useTabsStore } from "../../src/stores/tabs";

const erpnext = useErpnextStore();
const gateway = useGatewayStore();
const chat = useChatStore();
const sessions = useSessionsStore();
const layout = useLayoutStore();
const centerTabs = useCenterTabsStore();
const sessionTabs = useTabsStore();

const showShell = computed(() => erpnext.bootPhase === "ready");
const showLogin = computed(() => erpnext.bootPhase === "needs_login");
const showUrlGate = computed(() => erpnext.bootPhase === "needs_url");
const showConnecting = computed(() => erpnext.bootPhase === "connecting");
const showBootError = computed(() => erpnext.bootPhase === "error");
const showLoading = computed(() => erpnext.bootPhase === "loading");
const hasCenterTabs = computed(() => centerTabs.tabs.length > 0);

const connectGeneration = ref(0);

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  _label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("Could not connect"));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isStale(gen: number) {
  return gen !== connectGeneration.value;
}

function fitSidePanelLayout() {
  layout.agentOpen = true;
  layout.setAgentWidth(Math.max(320, window.innerWidth || 420));
}

async function connectAiFromSettings() {
  const gen = ++connectGeneration.value;
  erpnext.markConnecting(
    "Checking OpsPilot…",
    "Confirming this site has the OpsPilot app.",
  );

  try {
    const config = await withTimeout(
      erpnext.fetchSettings(),
      10_000,
      "Loading AI settings",
    );
    if (isStale(gen)) return;
    if (!config) return;

    erpnext.setConnectProgress(48, "Preparing connection…", "");
    await gateway.load();
    chat.ensureListener();
    if (isStale(gen)) return;

    let toConnect = { ...config };
    if (toConnect.authMode === "password" && toConnect.password?.trim()) {
      erpnext.setConnectProgress(62, "Signing in to AI…", "");
      toConnect = await withTimeout(
        gateway.signIn(toConnect),
        12_000,
        "AI gateway sign-in",
      );
    } else {
      await gateway.save({ ...toConnect, password: "" });
    }
    if (isStale(gen)) return;

    erpnext.setConnectProgress(78, "Opening AI session…", "");
    await withTimeout(
      gateway.connect({ ...toConnect, password: "" }),
      15_000,
      "AI gateway connect",
    );
    if (isStale(gen)) return;

    erpnext.setConnectProgress(88, "Finishing up…", "Loading your sessions.");
    for (let i = 0; i < 40 && !gateway.isConnected; i++) {
      if (isStale(gen)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (isStale(gen)) return;

    if (gateway.isConnected) {
      await sessions.refresh();
      if (isStale(gen)) return;
      await sessionTabs.restoreAfterSessionsLoad();
      await centerTabs.restoreActiveContent();
    } else if (!gateway.lastError) {
      throw new Error("Could not connect");
    }

    if (isStale(gen)) return;
    erpnext.setConnectProgress(100, "Ready", "");
    erpnext.markReady();
    layout.closeSettings();
  } catch (error) {
    if (isStale(gen)) return;
    const message = error instanceof Error ? error.message : String(error);
    if (erpnext.bootPhase !== "needs_login") {
      erpnext.markError(message);
    }
  }
}

async function onCancelConnect() {
  connectGeneration.value += 1;
  try {
    await gateway.disconnect();
  } catch {
    // ignore
  }
  erpnext.markNeedsLogin();
}

async function onLoginSuccess() {
  await connectAiFromSettings();
}

async function onUrlSaved() {
  layout.closeSettings();
  if (erpnext.bootPhase === "connecting" && erpnext.loggedIn) {
    await connectAiFromSettings();
  }
}

async function onLogout() {
  connectGeneration.value += 1;
  try {
    await gateway.disconnect();
  } catch {
    // ignore
  }
  await erpnext.logout();
  layout.closeSettings();
}

async function onRetry() {
  if (!erpnext.loggedIn) {
    erpnext.markNeedsLogin();
    return;
  }
  await connectAiFromSettings();
}

onMounted(async () => {
  fitSidePanelLayout();
  window.addEventListener("resize", fitSidePanelLayout);
  centerTabs.hydrate();
  await gateway.load();
  chat.ensureListener();
  await erpnext.load();
  if (erpnext.bootPhase === "connecting" && erpnext.loggedIn) {
    await connectAiFromSettings();
  }
});

watch(
  () => layout.agentOpen,
  (open) => {
    if (!open) layout.agentOpen = true;
  },
);
</script>

<template>
  <FrappeUIProvider>
    <DesktopShell :scroll="false" class="h-full bg-white">
      <div
        class="opspilot-sidepanel-shell relative flex h-full min-h-0 flex-col bg-white"
      >
        <AppTopBar
          v-if="showShell || layout.settingsOpen"
          @logout="onLogout"
        />

        <div
          v-if="
            showShell &&
            gateway.lastError &&
            !gateway.isConnected &&
            !layout.settingsOpen
          "
          class="flex items-center justify-between gap-3 border-b border-outline-gray-2 bg-surface-red-1 px-4 py-2 text-sm text-ink-red-4"
        >
          <span class="truncate">{{ gateway.lastError }}</span>
          <Button
            label="Retry"
            variant="subtle"
            size="sm"
            @click="onRetry()"
          />
        </div>

        <!-- Side panel: center stacked above full-width agent -->
        <div
          v-show="showShell && !layout.settingsOpen"
          class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <div
            v-show="hasCenterTabs"
            class="sidepanel-center min-h-0 shrink-0 overflow-hidden"
          >
            <CenterWorkspace />
          </div>
          <div class="agent-host flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <AgentPanel />
          </div>
        </div>

        <div
          v-if="showLoading"
          class="flex min-h-0 flex-1 items-center justify-center text-sm text-ink-gray-6"
        >
          Starting OpsPilot…
        </div>

        <div
          v-else-if="showUrlGate && !showShell"
          class="flex min-h-0 flex-1 flex-col bg-white"
        >
          <div
            class="flex h-11 shrink-0 items-center justify-center border-b border-outline-gray-2"
          >
            <div class="text-sm font-medium tracking-tight text-ink-gray-8">
              OpsPilot
            </div>
          </div>
          <div class="min-h-0 flex-1 overflow-auto">
            <SettingsView gate @saved="onUrlSaved" />
          </div>
        </div>

        <div
          v-else-if="showLogin"
          class="flex min-h-0 flex-1 flex-col bg-white"
        >
          <div
            class="flex h-11 shrink-0 items-center justify-center border-b border-outline-gray-2"
          >
            <div class="text-sm font-medium tracking-tight text-ink-gray-8">
              OpsPilot
            </div>
          </div>
          <LoginView
            @success="onLoginSuccess"
            @change-site="erpnext.openUrlSettings()"
          />
        </div>

        <ConnectingView
          v-else-if="showConnecting"
          :progress="erpnext.connectProgress"
          :status="erpnext.connectStatus || 'Connecting…'"
          :detail="erpnext.connectDetail"
          @cancel="onCancelConnect"
        />

        <div
          v-else-if="showBootError"
          class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-white px-6"
        >
          <div class="max-w-md text-center">
            <div class="text-sm font-medium text-ink-gray-8">
              {{
                erpnext.accessError === "unsupported_site"
                  ? "Site not supported"
                  : erpnext.accessError === "not_permitted"
                    ? "Not permitted"
                    : "Could not connect"
              }}
            </div>
            <p class="mt-2 text-sm text-ink-red-4">
              {{
                erpnext.lastError ||
                gateway.lastError ||
                "Something went wrong."
              }}
            </p>
          </div>
          <div class="flex flex-wrap items-center justify-center gap-2">
            <Button
              v-if="erpnext.loggedIn"
              label="Retry"
              variant="solid"
              @click="onRetry()"
            />
            <Button label="Sign out" variant="subtle" @click="onLogout()" />
            <Button
              label="Change site URL"
              variant="ghost"
              @click="erpnext.openUrlSettings()"
            />
          </div>
        </div>

        <div
          v-if="showShell && layout.settingsOpen"
          class="flex min-h-0 flex-1 flex-col bg-white"
        >
          <div
            class="flex h-10 shrink-0 items-center justify-between border-b border-outline-gray-2 px-4"
          >
            <div class="text-sm font-medium text-ink-gray-8">Settings</div>
            <button
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-gray-6 hover:bg-surface-gray-2"
              title="Close settings"
              @click="layout.closeSettings()"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-auto bg-white">
            <SettingsView embedded @saved="onUrlSaved" />
          </div>
        </div>
      </div>
    </DesktopShell>
  </FrappeUIProvider>
</template>
