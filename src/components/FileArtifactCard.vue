<script setup lang="ts">
import { ref } from "vue";
import { saveGatewayArtifactAs } from "../lib/downloadArtifact";
import { labelForExt, type FileArtifact } from "../lib/extractFileArtifacts";
import { useGatewayStore } from "../stores/gateway";

const props = defineProps<{
  artifact: FileArtifact;
}>();

const gateway = useGatewayStore();
const busy = ref(false);
const status = ref<string | null>(null);

async function onDownload() {
  if (!gateway.isConfigured || busy.value) return;
  busy.value = true;
  status.value = null;
  try {
    const saved = await saveGatewayArtifactAs(
      gateway.connection,
      props.artifact.path,
    );
    if (!saved) {
      status.value = null;
      return;
    }
    status.value = `Saved to ${saved.localPath}`;
  } catch (err) {
    status.value =
      err instanceof Error ? err.message : `Download failed: ${String(err)}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="my-2">
    <div
      class="flex items-center gap-2 rounded-[10px] border border-[#e4e4e4] bg-white px-3 py-2"
    >
      <span class="text-[12px] text-[#8a8a8a]" aria-hidden="true">
        {{ labelForExt(artifact.ext) }}
      </span>
      <div class="min-w-0 flex-1 truncate text-[13px] text-[#3c3c3c]">
        {{ artifact.filename }}
      </div>
      <button
        type="button"
        class="shrink-0 rounded-md bg-[#efefef] px-2.5 py-1 text-[12px] text-[#1e1e1e] hover:bg-[#e4e4e4] disabled:opacity-50"
        :disabled="busy || !gateway.isConfigured"
        @click="onDownload"
      >
        {{ busy ? "Saving…" : "Download" }}
      </button>
    </div>
    <div v-if="status" class="mt-1 px-1 text-[11px] text-[#6b6b6b]">
      {{ status }}
    </div>
  </div>
</template>
