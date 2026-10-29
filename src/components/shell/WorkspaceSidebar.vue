<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import FileTree from "../FileTree.vue";
import { useCenterTabsStore } from "../../stores/centerTabs";
import { useFilesStore } from "../../stores/files";
import { useGatewayStore } from "../../stores/gateway";

const files = useFilesStore();
const gateway = useGatewayStore();
const center = useCenterTabsStore();

/** Sidebar rail: files tree vs browser shortcut (does not flip center mode). */
const rail = ref<"files" | "browser">("files");

async function loadFiles() {
  if (gateway.isConnected && gateway.isConfigured) {
    await files.bootstrap();
  }
}

onMounted(loadFiles);
watch(
  () => [gateway.isConnected, gateway.connection.url],
  () => {
    void loadFiles();
  },
);

function showFiles() {
  rail.value = "files";
}

function openBrowser() {
  rail.value = "browser";
  center.openOrFocusBrowser();
}
</script>

<template>
  <aside
    class="flex h-full w-64 shrink-0 flex-col border-r border-[#e8e8e8] bg-[#f8f8f8]"
  >
    <div class="flex items-center gap-1 border-b border-[#e8e8e8] p-1.5">
      <button
        type="button"
        class="flex-1 rounded px-2 py-1.5 text-xs"
        :class="
          rail === 'files'
            ? 'bg-white text-[#1e1e1e] shadow-sm'
            : 'text-[#6b6b6b] hover:bg-[#ebebeb]'
        "
        @click="showFiles"
      >
        Files
      </button>
      <button
        type="button"
        class="flex-1 rounded px-2 py-1.5 text-xs"
        :class="
          rail === 'browser'
            ? 'bg-white text-[#1e1e1e] shadow-sm'
            : 'text-[#6b6b6b] hover:bg-[#ebebeb]'
        "
        @click="openBrowser"
      >
        Browser
      </button>
    </div>
    <div class="min-h-0 flex-1 overflow-hidden">
      <FileTree class="h-full min-h-0" />
    </div>
  </aside>
</template>
