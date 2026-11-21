<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Button, FrappeUIProvider } from "frappe-ui";
import ConnectingView from "../../src/views/ConnectingView.vue";
import SettingsView from "../../src/views/SettingsView.vue";
import { gatewaySiteState } from "../../src/lib/native";
import { useChatStore } from "../../src/stores/chat";
import { useErpnextStore } from "../../src/stores/erpnext";
import { useGatewayStore } from "../../src/stores/gateway";
import { useLayoutStore } from "../../src/stores/layout";
import { useSessionsStore } from "../../src/stores/sessions";
import { useTabsStore } from "../../src/stores/tabs";
import { useErpnextContext } from "./composables/useErpnextContext";
import SideChat from "./components/SideChat.vue";
import SideDisabledOverlay from "./components/SideDisabledOverlay.vue";
import SideHeader from "./components/SideHeader.vue";

const erpnext = useErpnextStore();
const gateway = useGatewayStore();
const chat = useChatStore();
const sessions = useSessionsStore();
const layout = useLayoutStore();
const sessionTabs = useTabsStore();
const {
  siteGate,
  siteHost,
  checking,
  focusedSite,
  activeSiteKey,
  activeSiteUrl,
  refresh: refreshSiteGate,
} = useErpnextContext();

const showShell = computed(() => erpnext.bootPhase === "ready");
const showUrlGate = computed(() => erpnext.bootPhase === "needs_url");
const showConnecting = computed(() => erpnext.bootPhase === "connecting");
const showBootError = computed(() => erpnext.bootPhase === "error");
const showLoading = computed(() => erpnext.bootPhase === "loading");

/** Waiting for Desk session / site gate — no password form in the side panel. */
const showWaiting = computed(
  () =>
    !showShell.value &&
    !showUrlGate.value &&
    !showConnecting.value &&
    !showBootError.value &&
    !showLoading.value,
);

/**
 * Overlay when the focused tab isn't a ready OpsPilot Desk tab.
 * With tab-scoped panels this is uncommon, but still covers login/settings gaps.
 */
const showDisabledOverlay = computed(() => {
  if (showUrlGate.value || showLoading.value || showConnecting.value) return false;
  if (layout.settingsOpen) return false;
  if (checking.value && siteGate.value.status === "checking" && !showShell.value) {
    return true;
  }
  return siteGate.value.status !== "ok";
});

const waitingCopy = computed(() => {
  if (checking.value || siteGate.value.status === "checking") {
    return {
      title: "Checking this OpsPilot site…",
      body: "Looking for a signed-in Desk session and AI settings.",
    };
  }
  switch (siteGate.value.status) {
    case "ok":
      return {
        title: "Connecting…",
        body: "Desk session found — opening chat.",
      };
    case "not_logged_in":
      return {
        title: "Desk isn’t signed in",
        body: "Sign in on this Desk tab, then click Retry.",
      };
    case "no_site":
      return {
        title: "No OpsPilot site here",
        body: "Open a Desk tab where the OpsPilot app is installed.",
      };
    default:
      return {
        title: "Waiting for this OpsPilot site",
        body: "Sign in on Desk — OpsPilot picks up that session automatically.",
      };
  }
});

const connectGeneration = ref(0);
const startingFromSite = ref(false);
const boundSiteKey = ref<string | null>(null);

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

async function bindStoresToSite(siteKey: string, siteUrl: string) {
  boundSiteKey.value = siteKey;
  await gateway.setActiveSite(siteKey);
  sessions.bindSite(siteKey);
  sessionTabs.bindSite(siteKey);
  chat.reset();
  erpnext.resetForSiteSwitch(siteUrl);
  await erpnext.activateSite(siteUrl);
}

async function hydrateConnectedSite(siteKey: string) {
  const native = await gatewaySiteState(siteKey);
  if (!native.connected) return false;
  await gateway.load();
  gateway.$patch({
    state: "open",
    ready: true,
    lastError: null,
    detail: null,
  });
  chat.ensureListener();
  await sessions.refresh();
  await sessionTabs.restoreAfterSessionsLoad();
  erpnext.markReady();
  return true;
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
    erpnext.markError(message);
  }
}

/**
 * Desk tab is ready → adopt browser sid → Hermes → chat.
 * Auto-start only from needs_login; errors / reconnects use force.
 */
async function startFromBrowserSession(opts?: { force?: boolean }) {
  if (startingFromSite.value) return;
  if (siteGate.value.status !== "ok") return;
  const site = focusedSite.value;
  if (!site) return;
  if (layout.settingsOpen) return;
  if (
    erpnext.bootPhase === "ready" &&
    gateway.isConnected &&
    boundSiteKey.value === site.siteKey
  ) {
    return;
  }
  if (!opts?.force && erpnext.bootPhase === "connecting") return;
  if (!opts?.force && erpnext.bootPhase === "error") return;

  startingFromSite.value = true;
  try {
    if (boundSiteKey.value !== site.siteKey) {
      await bindStoresToSite(site.siteKey, site.siteUrl);
    } else {
      await erpnext.activateSite(site.siteUrl);
      await gateway.setActiveSite(site.siteKey);
    }

    // Reuse an already-open Hermes socket for this site.
    if (!opts?.force) {
      const reused = await hydrateConnectedSite(site.siteKey);
      if (reused) return;
    }

    erpnext.markConnecting(
      "Using site session…",
      "Reading your OpsPilot login from the Desk tab.",
    );
    await withTimeout(erpnext.adoptBrowserSession(site.siteUrl), 8_000);
    await connectAiFromSettings();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    erpnext.markError(message);
  } finally {
    startingFromSite.value = false;
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

async function onUrlSaved() {
  layout.closeSettings();
  if (siteGate.value.status === "ok") {
    await startFromBrowserSession({ force: true });
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
  if (activeSiteUrl.value) {
    erpnext.markNeedsLogin();
  }
  await refreshSiteGate();
  if (siteGate.value.status === "ok") {
    await startFromBrowserSession({ force: true });
  }
}

async function focusOpspilotSite() {
  const host = siteHost.value || activeSiteKey.value;
  if (!host) return;
  try {
    const all = await chrome.tabs.query({});
    const hit = all.find((t) => {
      try {
        return t.url && new URL(t.url).hostname.toLowerCase() === host;
      } catch {
        return false;
      }
    });
    if (hit?.id != null) {
      await chrome.tabs.update(hit.id, { active: true });
      if (hit.windowId != null) {
        await chrome.windows.update(hit.windowId, { focused: true });
      }
      return;
    }
  } catch {
    // fall through
  }
  const url = activeSiteUrl.value || erpnext.siteUrl.trim();
  if (url) await chrome.tabs.create({ url });
}

watch(
  () => focusedSite.value?.siteKey ?? null,
  async (nextKey, prevKey) => {
    if (!nextKey) return;
    const switched = Boolean(prevKey) && nextKey !== prevKey;
    if (nextKey !== boundSiteKey.value) {
      connectGeneration.value += 1;
      startingFromSite.value = false;
      await bindStoresToSite(
        nextKey,
        focusedSite.value?.siteUrl || `https://${nextKey}`,
      );
    }
    if (siteGate.value.status === "ok") {
      await startFromBrowserSession({ force: switched });
    }
  },
);

watch(
  () => siteGate.value.status,
  (status) => {
    if (status === "ok" && erpnext.bootPhase === "needs_login") {
      void startFromBrowserSession();
    }
  },
);

onMounted(async () => {
  layout.agentOpen = true;
  chat.ensureListener();
  await erpnext.load();
  erpnext.markNeedsLogin();
  // Focused-tab watch binds stores + connects once siteGate is ok.
  await refreshSiteGate();
  if (siteGate.value.status === "ok" && focusedSite.value) {
    await startFromBrowserSession({ force: true });
  }
});
</script>

<template>
  <FrappeUIProvider>
    <div
      class="opspilot-sidepanel-shell relative flex h-full min-h-0 flex-col bg-white"
    >
        <SideDisabledOverlay
          v-if="showDisabledOverlay"
          :gate="siteGate"
          :site-host="siteHost"
          @open-site="focusOpspilotSite"
          @change-site="layout.openSettings()"
          @sign-in="focusOpspilotSite"
          @retry="onRetry()"
        />

        <div
          v-show="showShell && !layout.settingsOpen"
          class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <SideChat @logout="onLogout" @settings="layout.openSettings()" />
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
              <Button label="Retry" variant="solid" @click="onRetry()" />
              <Button
                label="Site details"
                variant="ghost"
                @click="layout.openSettings()"
              />
            </div>
          </div>
        </div>

        <div
          v-else-if="showWaiting"
          class="flex min-h-0 flex-1 flex-col bg-white"
        >
          <SideHeader @settings="layout.openSettings()" />
          <div
            class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
          >
            <div class="text-[14px] font-medium text-[#1a1a1a]">
              {{ waitingCopy.title }}
            </div>
            <p class="max-w-xs text-[13px] text-[#6b6b6b]">
              {{ waitingCopy.body }}
            </p>
            <p
              v-if="siteHost || siteGate.detail"
              class="max-w-xs text-[11px] text-[#8a8a8a]"
            >
              <template v-if="siteGate.detail">{{ siteGate.detail }}</template>
              <template v-else>
                Site: {{ siteHost }}
                <span v-if="siteGate.username"> · {{ siteGate.username }}</span>
              </template>
            </p>
            <Button
              label="Retry"
              variant="solid"
              :loading="checking"
              :disabled="checking"
              @click="onRetry()"
            />
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
              Site details
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
  </FrappeUIProvider>
</template>
