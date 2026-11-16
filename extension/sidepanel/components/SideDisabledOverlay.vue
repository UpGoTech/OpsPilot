<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useErpnextStore } from "../../../src/stores/erpnext";

const props = defineProps<{
  siteHost: string;
}>();

const emit = defineEmits<{
  openErpnext: [];
}>();

const erpnext = useErpnextStore();

const QUOTES = [
  "ERPNext went out for chai. This tab has only vibes.",
  "404: Desk not found. Your ERPNext tab is MIA.",
  "OpsPilot checked under the desk. No DocTypes. Only crumbs.",
  "This is not the DocType you're looking for.",
  "Frappe called — your site isn't in this window.",
  "No sid here. Also no site. Switch to ERPNext?",
  "Bench is running… somewhere else. Not this tab.",
  "ERPNext left the chat. Bring it back and we'll talk.",
  "Looking for Stock Entry? Try looking for the ERPNext tab first.",
  "Your workspace is elsewhere. This panel is just holding its breath.",
  "Houston, we have a problem: zero ERPNext detected.",
  "Plot twist: this tab is not fxl.localhost (or wherever you live).",
];

const quoteIndex = ref(Math.floor(Math.random() * QUOTES.length));

watch(
  () => props.siteHost,
  () => {
    quoteIndex.value = Math.floor(Math.random() * QUOTES.length);
  },
);

const quote = computed(() => QUOTES[quoteIndex.value] ?? QUOTES[0]!);

const siteLabel = computed(
  () => props.siteHost || erpnext.siteUrl.trim() || "your ERPNext site",
);

function nextQuote() {
  quoteIndex.value = (quoteIndex.value + 1) % QUOTES.length;
}
</script>

<template>
  <div
    class="side-disabled-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="ERPNext tab required"
  >
    <div class="side-disabled-overlay-card">
      <div class="side-disabled-kicker">ERPNext not found</div>
      <p class="side-disabled-quote" @click="nextQuote" title="Another one?">
        “{{ quote }}”
      </p>
      <p class="side-disabled-hint">
        Open
        <span class="font-medium text-[#1a1a1a]">{{ siteLabel }}</span>
        in this window to wake OpsPilot up.
      </p>
      <button
        type="button"
        class="side-disabled-cta"
        @click="emit('openErpnext')"
      >
        Open ERPNext
      </button>
    </div>
  </div>
</template>
