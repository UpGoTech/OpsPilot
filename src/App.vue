<script setup lang="ts">
import { computed, onMounted } from "vue";
import { Button, DesktopShell, FrappeUIProvider } from "frappe-ui";
import AgentPanel from "./components/shell/AgentPanel.vue";
import AppTopBar from "./components/shell/AppTopBar.vue";
import CenterWorkspace from "./components/shell/CenterWorkspace.vue";
import LoginView from "./views/LoginView.vue";
import SettingsView from "./views/SettingsView.vue";
import { useCenterTabsStore } from "./stores/centerTabs";
import { useChatStore } from "./stores/chat";
import { useErpnextStore } from "./stores/erpnext";
import { useGatewayStore } from "./stores/gateway";
import { useLayoutStore } from "./stores/layout";
import { useSessionsStore } from "./stores/sessions";
import { useTabsStore } from "./stores/tabs";

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

async function connectHermesFromSettings() {
  erpnext.markConnecting();
  try {
    const config = await erpnext.fetchSettings();
    if (!config) {
      return;
    }
    await gateway.load();
    chat.ensureListener();

    let toConnect = { ...config };
    if (toConnect.authMode === "password" && toConnect.password?.trim()) {
      toConnect = await gateway.signIn(toConnect);
    } else {
      await gateway.save({ ...toConnect, password: "" });
    }
    await gateway.connect({ ...toConnect, password: "" });

    for (let i = 0; i < 40 && !gateway.isConnected; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (gateway.isConnected) {
      await sessions.refresh();
      await sessionTabs.restoreAfterSessionsLoad();
      await centerTabs.restoreActiveContent();
    }
    erpnext.markReady();
    layout.closeSettings();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (erpnext.bootPhase !== "needs_login") {
      erpnext.markError(message);
    }
  }
}

async function onLoginSuccess() {
  await connectHermesFromSettings();
}

async function onUrlSaved() {
  layout.closeSettings();
  if (erpnext.bootPhase === "connecting" && erpnext.loggedIn) {
    await connectHermesFromSettings();
  }
}

async function onLogout() {
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
  await connectHermesFromSettings();
}

onMounted(async () => {
  centerTabs.hydrate();
  await gateway.load();
  chat.ensureListener();
  await erpnext.load();
  if (erpnext.bootPhase === "connecting" && erpnext.loggedIn) {
    await connectHermesFromSettings();
  }
});
</script>

<template>
  <FrappeUIProvider>
    <DesktopShell :scroll="false" class="h-full bg-white">
      <div class="relative flex h-full min-h-0 flex-col bg-white">
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

        <!-- Main workspace -->
        <div
          v-show="showShell && !layout.settingsOpen"
          class="flex min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          <CenterWorkspace />
          <AgentPanel />
        </div>

        <!-- Boot: loading -->
        <div
          v-if="showLoading"
          class="flex min-h-0 flex-1 items-center justify-center text-sm text-ink-gray-6"
        >
          Starting OpsPilot…
        </div>

        <!-- Boot: ERPNext URL required -->
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

        <!-- Boot: login -->
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

        <!-- Boot: connecting -->
        <div
          v-else-if="showConnecting"
          class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-white px-6 text-sm text-ink-gray-6"
        >
          <div class="text-sm font-medium text-ink-gray-8">Connecting…</div>
          <p>Loading your Hermes settings from ERPNext.</p>
        </div>

        <!-- Boot: error (missing DocType / Hermes) -->
        <div
          v-else-if="showBootError"
          class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-white px-6"
        >
          <div class="max-w-md text-center">
            <div class="text-sm font-medium text-ink-gray-8">
              {{ erpnext.settingsMissing ? "Settings missing" : "Could not connect" }}
            </div>
            <p class="mt-2 text-sm text-ink-red-4">
              {{ erpnext.lastError || gateway.lastError || "Something went wrong." }}
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

        <!-- Settings overlay (ERPNext URL) while shell is ready -->
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
