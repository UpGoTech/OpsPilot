<script setup lang="ts">
import { onMounted, watch } from "vue";
import FileTree from "../components/FileTree.vue";
import { useFilesStore } from "../stores/files";
import { useGatewayStore } from "../stores/gateway";

const files = useFilesStore();
const gateway = useGatewayStore();

async function loadIfReady() {
  if (gateway.isConnected && gateway.isConfigured) {
    await files.bootstrap();
  }
}

onMounted(loadIfReady);
watch(
  () => [gateway.isConnected, gateway.connection.url],
  () => {
    void loadIfReady();
  },
);
</script>

<template>
  <div class="flex h-full min-h-0">
    <aside class="flex w-80 shrink-0 flex-col border-r border-outline-gray-1 bg-surface-gray-1">
      <div class="border-b border-outline-gray-1 px-4 py-3 text-sm font-medium text-ink-gray-8">
        Workspace
      </div>
      <FileTree class="min-h-0 flex-1" />
    </aside>
    <section class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-12 items-center border-b border-outline-gray-1 px-6">
        <div class="truncate text-sm font-medium text-ink-gray-8">
          {{ files.selectedPath || "Select a file" }}
        </div>
      </header>
      <div class="min-h-0 flex-1 overflow-auto px-6 py-4">
        <div v-if="files.previewLoading" class="text-sm text-ink-gray-5">Reading file…</div>
        <div v-else-if="files.error && files.selectedPath" class="text-sm text-ink-red-3">
          {{ files.error }}
        </div>
        <pre
          v-else-if="files.selectedPath"
          class="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-ink-gray-8"
        >{{ files.preview }}</pre>
        <div v-else class="mt-24 text-center text-sm text-ink-gray-5">
          Browse the remote Hermes workspace and open a text file to preview it.
        </div>
      </div>
    </section>
  </div>
</template>
