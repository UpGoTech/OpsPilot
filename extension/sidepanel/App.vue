<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Button, DesktopShell, FrappeUIProvider } from "frappe-ui";
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
import SideChat from "./components/SideChat.vue";
import SideHeader from "./components/SideHeader.vue";

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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
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

async function connectAiFromSettings() {
  const gen = ++connectGeneration.value;
  erpnext.markConnecting(
    "Checking OpsPilot…",
    "Confirming this site has the OpsPilot app.",
  );

  try {
    const config = await withTimeout(erpnext.fetchSettings(), 10_000);
    if (isStale(gen)) return;
    if (!config) return;

    erpnext.setConnectProgress(48, "Preparing connection…", "");
    await gateway.load();
    chat.ensureListener();
    if (isStale(gen)) return;

    let toConnect = { ...config };
    if (toConnect.authMode === "password" && toConnect.password?.trim()) {
      erpnext.setConnectProgress(62, "Signing in to AI…", "");
      toConnect = await withTimeout(gateway.signIn(toConnect), 12_000);
    } else {
      await gateway.save({ ...toConnect, password: "" });
    }
    if (isStale(gen)) return;

    erpnext.setConnectProgress(78, "Opening AI session…", "");
    await withTimeout(gateway.connect({ ...toConnect, password: "" }), 15_000);
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
  layout.agentOpen = true;
  centerTabs.hydrate();
  await gateway.load();
  chat.ensureListener();
  await erpnext.load();
  if (erpnext.bootPhase === "connecting" && erpnext.loggedIn) {
    await connectAiFromSettings();
  }
});
</script>

<template>
  <FrappeUIProvider>
    <DesktopShell :scroll="false" class="h-full bg-white">
      <div
        class="opspilot-sidepanel-shell relative flex h-full min-h-0 flex-col bg-white"
      >
        <!-- Ready shell: Leo-style chat -->
        <div
          v-show="showShell && !layout.settingsOpen"
          class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <div
            v-show="hasCenterTabs"
            class="sidepanel-center min-h-0 shrink-0 overflow-hidden border-b border-[#ececec]"
          >
            <CenterWorkspace />
          </div>
          <div class="min-h-0 flex-1 overflow-hidden">
            <SideChat @logout="onLogout" @settings="layout.openSettings()" />
          </div>
        </div>

        <div
          v-if="showLoading"
          class="flex min-h-0 flex-1 flex-col bg-white"
        >
          <SideHeader />
          <div
            class="flex flex-1 items-center justify-center text-[13px] text-[#8a8a8a]"
          >
            Starting OpsPilot…
          </div>
        </div>

        <div
          v-else-if="showUrlGate && !showShell"
          class="flex min-h-0 flex-1 flex-col bg-white"
        >
          <SideHeader @settings="layout.openSettings()" />
          <div class="min-h-0 flex-1 overflow-auto">
            <SettingsView gate @saved="onUrlSaved" />
          </div>
        </div>

        <div
          v-else-if="showLogin"
          class="flex min-h-0 flex-1 flex-col bg-white"
        >
          <SideHeader
            @settings="erpnext.openUrlSettings()"
            @logout="onLogout"
          />
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
          class="flex min-h-0 flex-1 flex-col bg-white"
        >
          <SideHeader @logout="onLogout" @settings="layout.openSettings()" />
          <div
            class="flex flex-1 flex-col items-center justify-center gap-4 px-6"
          >
            <div class="max-w-md text-center">
              <div class="text-[14px] font-semibold text-[#1a1a1a]">
                {{
                  erpnext.accessError === "unsupported_site"
                    ? "Site not supported"
                    : erpnext.accessError === "not_permitted"
                      ? "Not permitted"
                      : "Could not connect"
                }}
              </div>
              <p class="mt-2 text-[13px] text-[#b42318]">
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
        </div>

        <div
          v-if="showShell && layout.settingsOpen"
          class="flex min-h-0 flex-1 flex-col bg-white"
        >
          <SideHeader
            @logout="onLogout"
            @settings="layout.closeSettings()"
          />
          <div
            class="flex h-10 shrink-0 items-center justify-between border-b border-[#ececec] px-4"
          >
            <div class="text-[13px] font-medium text-[#1a1a1a]">
              Advanced settings
            </div>
            <button
              type="button"
              class="side-icon-btn"
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
                stroke-width="1.75"
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
