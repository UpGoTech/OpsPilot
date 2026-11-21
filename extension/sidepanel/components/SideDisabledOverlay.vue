<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SiteGate } from "../composables/useErpnextContext";

const props = defineProps<{
  gate: SiteGate;
  siteHost: string;
}>();

const emit = defineEmits<{
  openSite: [];
  changeSite: [];
  signIn: [];
  retry: [];
}>();

const WRONG_TAB_QUOTES = [
  "OpsPilot went out for chai. This tab has only vibes.",
  "404: Desk not found. Your OpsPilot tab is MIA.",
  "OpsPilot checked under the desk. No DocTypes. Only crumbs.",
  "This is not the DocType you're looking for.",
  "OpsPilot called — your site isn't in this window.",
  "Bench is running… somewhere else. Not this tab.",
  "OpsPilot left the chat. Bring the site back and we'll talk.",
  "Houston, we have a problem: zero OpsPilot site detected.",
];

const SAD_QUOTES = [
  "OpsPilot is available… just not on this site. Cue tiny violin.",
  "This site has Desk energy, but zero OpsPilot energy.",
  "We knocked. opspilot_frappe didn't answer. Sad trombone.",
  "OpsPilot looked for itself on this site and came back empty-handed.",
  "Almost home — but OpsPilot isn't installed here. Tragic.",
];

const CRY_QUOTES = [
  "OpsPilot saw your login… and still cried. No settings row.",
  "So close. OpsPilot isn't enabled for this account yet.",
  "The app is here. Your OpsPilot Settings aren't. Sniff.",
  "Permission to use AI: denied. OpsPilot needs a tissue.",
];

const quoteIndex = ref(0);

watch(
  () => `${props.gate.status}:${props.gate.username}:${props.siteHost}`,
  () => {
    quoteIndex.value = Math.floor(Math.random() * 8);
  },
  { immediate: true },
);

const quotePool = computed(() => {
  switch (props.gate.status) {
    case "opspilot_unavailable":
      return SAD_QUOTES;
    case "user_not_enabled":
      return CRY_QUOTES;
    default:
      return WRONG_TAB_QUOTES;
  }
});

const quote = computed(() => {
  const pool = quotePool.value;
  return pool[quoteIndex.value % pool.length] ?? pool[0]!;
});

const kicker = computed(() => {
  switch (props.gate.status) {
    case "checking":
      return "Checking";
    case "not_logged_in":
      return "Not signed in";
    case "opspilot_unavailable":
      return "OpsPilot unavailable";
    case "user_not_enabled":
      return "OpsPilot not enabled";
    default:
      return "OpsPilot site not found";
  }
});

const headline = computed(() => {
  switch (props.gate.status) {
    case "checking":
      return "Looking for your signed-in Desk tab…";
    case "not_logged_in":
      return "You're on the right site, but Desk isn't signed in.";
    case "opspilot_unavailable":
      return quote.value;
    case "user_not_enabled": {
      const who = props.gate.username || "this user";
      return `OpsPilot is not enabled for ${who}`;
    }
    default:
      return quote.value;
  }
});

const hint = computed(() => {
  if (props.gate.detail?.trim()) return props.gate.detail.trim();
  const host = props.siteHost || "your OpsPilot site";
  switch (props.gate.status) {
    case "checking":
      return `Probing ${host}. If this hangs, refresh the Desk tab and click Retry.`;
    case "not_logged_in":
      return `Sign in on the Desk tab for ${host} — OpsPilot uses that session.`;
    case "opspilot_unavailable":
      return `Install the OpsPilot app on ${host}, then try again.`;
    case "user_not_enabled":
      return `Ask an admin to create OpsPilot Settings for ${props.gate.username || "this user"}.`;
    default:
      return `Open ${host} in this window to wake OpsPilot up.`;
  }
});

const showQuoteClick = computed(
  () =>
    props.gate.status === "wrong_tab" ||
    props.gate.status === "opspilot_unavailable" ||
    props.gate.status === "user_not_enabled",
);

const moodClass = computed(() => {
  switch (props.gate.status) {
    case "not_logged_in":
      return "is-login";
    case "opspilot_unavailable":
      return "is-sad";
    case "user_not_enabled":
      return "is-cry";
    default:
      return "is-lost";
  }
});

function nextQuote() {
  if (!showQuoteClick.value) return;
  quoteIndex.value += 1;
}
</script>

<template>
  <div
    class="side-disabled-overlay"
    :class="moodClass"
    role="dialog"
    aria-modal="true"
    :aria-label="kicker"
  >
    <div class="side-disabled-overlay-card">
      <div class="side-disabled-mood" aria-hidden="true">
        <!-- lock -->
        <svg
          v-if="gate.status === 'not_logged_in'"
          xmlns="http://www.w3.org/2000/svg"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <!-- sad face -->
        <svg
          v-else-if="gate.status === 'opspilot_unavailable'"
          xmlns="http://www.w3.org/2000/svg"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M8 15s1.5-2 4-2 4 2 4 2" />
          <line x1="9" x2="9.01" y1="9" y2="9" />
          <line x1="15" x2="15.01" y1="9" y2="9" />
        </svg>
        <!-- cry face -->
        <svg
          v-else-if="gate.status === 'user_not_enabled'"
          xmlns="http://www.w3.org/2000/svg"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M8 15s1.5-2 4-2 4 2 4 2" />
          <path d="M9 9h.01" />
          <path d="M15 9h.01" />
          <path d="M9.5 19.5 9 17" />
          <path d="m14.5 19.5.5-2.5" />
        </svg>
        <!-- search -->
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </div>
      <div class="side-disabled-kicker">{{ kicker }}</div>
      <p
        class="side-disabled-quote"
        :class="showQuoteClick ? 'is-clickable' : ''"
        :title="showQuoteClick ? 'Another one?' : undefined"
        @click="nextQuote"
      >
        <template v-if="showQuoteClick">“{{ headline }}”</template>
        <template v-else>{{ headline }}</template>
      </p>
      <p class="side-disabled-hint">{{ hint }}</p>

      <button
        type="button"
        class="side-disabled-cta"
        @click="
          gate.status === 'checking'
            ? emit('retry')
            : gate.status === 'not_logged_in'
              ? emit('signIn')
              : emit('openSite')
        "
      >
        {{
          gate.status === "checking"
            ? "Retry"
            : gate.status === "not_logged_in"
              ? "Open Desk to sign in"
              : "Open OpsPilot site"
        }}
      </button>

      <button
        v-if="gate.status !== 'checking'"
        type="button"
        class="side-disabled-link"
        @click="emit('retry')"
      >
        Retry check
      </button>

      <button
        type="button"
        class="side-disabled-link"
        @click="emit('changeSite')"
      >
        Site details
      </button>
    </div>
  </div>
</template>
