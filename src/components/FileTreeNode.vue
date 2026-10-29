<script setup lang="ts">
import type { FsEntry } from "../types";
import { useFilesStore } from "../stores/files";

defineProps<{ entry: FsEntry }>();
const emit = defineEmits<{ activate: [entry: FsEntry] }>();
const files = useFilesStore();
</script>

<template>
  <li>
    <button
      type="button"
      class="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-surface-gray-2"
      :class="
        files.selectedPath === entry.path
          ? 'bg-surface-gray-3 text-ink-gray-9'
          : 'text-ink-gray-7'
      "
      @click="emit('activate', entry)"
    >
      <span class="w-3 text-ink-gray-5">
        <template v-if="files.isDir(entry)">
          {{ files.expanded[entry.path] ? "▾" : "▸" }}
        </template>
        <template v-else>·</template>
      </span>
      <span class="truncate">{{ entry.name }}</span>
    </button>
    <ul
      v-if="files.isDir(entry) && files.expanded[entry.path]"
      class="ml-3 border-l border-outline-gray-1 pl-2"
    >
      <FileTreeNode
        v-for="child in files.children[entry.path] || []"
        :key="child.path"
        :entry="child"
        @activate="emit('activate', $event)"
      />
    </ul>
  </li>
</template>
