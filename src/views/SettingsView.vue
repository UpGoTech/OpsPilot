<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { Button, FormControl } from "frappe-ui";
import { useErpnextStore } from "../stores/erpnext";
import { useGatewayStore } from "../stores/gateway";

const props = withDefaults(
  defineProps<{
    /** When true, drop page chrome that the shell already provides. */
    embedded?: boolean;
    /** When true, this is the first-run gate (no close affordance needed). */
    gate?: boolean;
  }>(),
  { embedded: false, gate: false },
);

const emit = defineEmits<{
  saved: [];
}>();

const erpnext = useErpnextStore();
const gateway = useGatewayStore();

const form = reactive({
  siteUrl: "",
});
const saving = ref(false);
const message = ref<string | null>(null);
const messageTone = ref<"ok" | "err">("ok");

watch(
  () => erpnext.siteUrl,
  (value) => {
    form.siteUrl = value ?? "";
  },
  { immediate: true },
);

async function onSave() {
  saving.value = true;
  message.value = null;
  try {
    if (gateway.isConnected) {
      await gateway.disconnect();
    }
    await erpnext.saveSiteUrl(form.siteUrl);
    messageTone.value = "ok";
    message.value = form.siteUrl.trim()
      ? "OpsPilot site URL saved. Sign in to continue."
      : "OpsPilot site URL cleared.";
    emit("saved");
  } catch (error) {
    messageTone.value = "err";
    message.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div
    class="mx-auto w-full max-w-lg px-6 py-10"
    :class="props.embedded || props.gate ? '' : 'pt-8'"
  >
    <div v-if="!props.embedded" class="mb-8">
      <h1 class="text-xl font-semibold tracking-tight text-ink-gray-9">
        Site details
      </h1>
      <p class="mt-1 text-sm text-ink-gray-6">
        OpsPilot opens only on Desk tabs where
        <span class="font-medium text-ink-gray-8">opspilot_frappe</span> is
        installed. Each site keeps its own AI connection. Credentials stay in
        Desk (<span class="font-medium text-ink-gray-8">OpsPilot Settings</span>).
      </p>
    </div>
    <div v-else class="mb-6">
      <p class="text-sm text-ink-gray-6">
        OpsPilot follows the focused Desk tab. Optional override below if you
        need to point at a specific site URL (local bench ports, etc.).
      </p>
    </div>

    <form class="flex flex-col gap-5" @submit.prevent="onSave">
      <FormControl
        v-model="form.siteUrl"
        type="text"
        label="Current / preferred site URL"
        placeholder="https://erp.example.com"
        autocomplete="url"
      />

      <p class="text-xs text-ink-gray-5">
        Normally leave this alone — open the Desk tab you want and OpsPilot
        binds to that hostname. Local bench example:
        <span class="font-medium text-ink-gray-7">http://sitename.localhost:8000</span>
        (use <span class="font-medium text-ink-gray-7">http</span>, not https).
      </p>

      <div
        v-if="message"
        class="text-sm"
        :class="messageTone === 'ok' ? 'text-ink-green-3' : 'text-ink-red-4'"
      >
        {{ message }}
      </div>

      <div class="flex items-center gap-2 pt-1">
        <Button
          type="submit"
          variant="solid"
          :loading="saving"
          :label="saving ? 'Saving…' : 'Save'"
        />
      </div>
    </form>
  </div>
</template>
