<script setup lang="ts">
import FileTreeNode from "./FileTreeNode.vue";
import { useCenterTabsStore } from "../stores/centerTabs";
import { useFilesStore } from "../stores/files";
import type { FsEntry } from "../types";

const files = useFilesStore();
const center = useCenterTabsStore();

async function onActivate(entry: FsEntry) {
  if (files.isDir(entry)) {
    await files.toggle(entry.path);
  } else {
    await center.openFileTab(entry.path);
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto px-2 py-2 text-sm">
    <div v-if="files.loading" class="px-2 py-3 text-ink-gray-5">Loading workspace…</div>
    <div v-else-if="files.error && !files.rootPath" class="px-2 py-3 text-ink-red-3">
      {{ files.error }}
    </div>
    <div v-else-if="!files.rootPath" class="px-2 py-3 text-ink-gray-5">
      Connect to a gateway to browse its workspace.
    </div>
    <ul v-else class="space-y-0.5">
      <li>
        <button
          type="button"
          class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-medium text-ink-gray-8 hover:bg-surface-gray-2"
          @click="files.toggle(files.rootPath!)"
        >
          <span class="text-ink-gray-5">
            {{ files.expanded[files.rootPath!] ? "▾" : "▸" }}
          </span>
          <span class="truncate">{{ files.rootPath }}</span>
        </button>
        <ul
          v-if="files.expanded[files.rootPath!]"
          class="ml-3 border-l border-outline-gray-1 pl-2"
        >
          <FileTreeNode
            v-for="entry in files.children[files.rootPath!] || []"
            :key="entry.path"
            :entry="entry"
            @activate="onActivate"
          />
        </ul>
      </li>
    </ul>
  </div>
</template>
