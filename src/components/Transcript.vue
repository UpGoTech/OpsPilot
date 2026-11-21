<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  extractFileArtifacts,
  lastHtmlPathFromTexts,
  refersToHtmlArtifact,
} from "../lib/extractFileArtifacts";
import { useChatStore } from "../stores/chat";
import ApprovalCard from "./ApprovalCard.vue";
import ClarifyCard from "./ClarifyCard.vue";
import MarkdownBody from "./MarkdownBody.vue";
import SecretPromptCard from "./SecretPromptCard.vue";
import TurnScaffold from "./TurnScaffold.vue";
import VaultSaveLoginCard from "./VaultSaveLoginCard.vue";

const chat = useChatStore();
const scroller = ref<HTMLElement | null>(null);

const approvals = computed(() => chat.pendingApprovals);
const clarifies = computed(() => chat.pendingClarify);
const secrets = computed(() => chat.pendingSecrets);
const vaultSaves = computed(() => chat.pendingVaultSaves);
const hasPrompts = computed(
  () =>
    approvals.value.length +
      clarifies.value.length +
      secrets.value.length +
      vaultSaves.value.length >
    0,
);

watch(
  () =>
    [
      chat.turns
        .map(
          (t) =>
            `${t.id}:${t.running}:${t.activity.length}:${t.replies.map((r) => r.content.length).join(",")}`,
        )
        .join("|"),
      chat.pendingApprovals.length,
      chat.pendingClarify.length,
      chat.pendingSecrets.length,
      chat.pendingVaultSaves.length,
      chat.statusLine ?? "",
    ].join("~"),
  async () => {
    await nextTick();
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  },
);

function visibleReplies(turn: (typeof chat.turns)[number]) {
  return turn.replies.filter((m) => m.content.trim() || m.streaming);
}

/** Tool stdout/detail — agent often names zips here without a full /opt path. */
function activitySources(turn: (typeof chat.turns)[number]): string[] {
  return turn.activity
    .flatMap((step) => [step.detail, step.output, step.label])
    .filter((s): s is string => Boolean(s && s.trim()));
}

/**
 * Hermes sometimes describes an HTML file without repeating its path
 * ("last generated…"). Re-surface the most recent HTML path from earlier
 * turns so Preview/Download cards still appear.
 */
function artifactSourcesFor(
  turn: (typeof chat.turns)[number],
  turnIndex: number,
  messageContent: string,
): string[] {
  const local = activitySources(turn);
  const hasHtml = extractFileArtifacts(messageContent, local).some(
    (f) => f.ext === "html" || f.ext === "htm",
  );
  if (hasHtml) return local;

  const userText = turn.user?.content ?? "";
  if (!refersToHtmlArtifact(userText, messageContent)) return local;

  const priorTexts: string[] = [];
  for (let i = 0; i < turnIndex; i++) {
    const prev = chat.turns[i];
    if (!prev) continue;
    priorTexts.push(...activitySources(prev));
    for (const reply of prev.replies) {
      if (reply.content?.trim()) priorTexts.push(reply.content);
    }
  }
  // Same-turn tools may still name the path even when prose does not.
  priorTexts.push(...local);

  const lastHtml = lastHtmlPathFromTexts(priorTexts);
  return lastHtml ? [...local, lastHtml] : local;
}

async function copyReply(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}
</script>

<template>
  <div
    ref="scroller"
    class="agent-transcript min-h-0 flex-1 overflow-y-auto bg-[#f7f7f7] px-3.5 py-3"
  >
    <div
      v-if="chat.loadingHistory"
      class="px-1 py-6 text-[13px] text-[#8a8a8a]"
    >
      Loading…
    </div>

    <div
      v-else-if="!chat.turns.length"
      class="flex h-full min-h-[220px] flex-col items-center justify-center px-6 text-center"
    >
      <div class="text-[14px] font-medium text-[#3c3c3c]">New chat</div>
      <p class="mt-1.5 max-w-[260px] text-[13px] leading-relaxed text-[#8a8a8a]">
        Ask AI to work with your remote workspace, files, and ERPNext.
      </p>
    </div>

    <div v-else class="mx-auto flex w-full max-w-[680px] flex-col gap-5">
      <article
        v-for="(turn, turnIndex) in chat.turns"
        :key="turn.id"
        class="flex flex-col gap-3"
      >
        <!-- User — soft Cursor bubble -->
        <div
          v-if="turn.user"
          class="rounded-[12px] border border-[#e6e6e6] bg-[#ececec] px-3.5 py-2.5"
        >
          <div
            v-if="turn.user.imagePreviews?.length || turn.user.fileLabels?.length"
            class="mb-2 flex flex-wrap gap-2"
          >
            <img
              v-for="(src, i) in turn.user.imagePreviews || []"
              :key="`${turn.id}-img-${i}`"
              :src="src"
              alt=""
              class="h-16 w-16 rounded-md object-cover"
            />
            <div
              v-for="(label, i) in turn.user.fileLabels || []"
              :key="`${turn.id}-file-${i}`"
              class="rounded-md border border-[#e0e0e0] bg-white px-2 py-1 text-[11px] text-[#3c3c3c]"
            >
              {{ label }}
            </div>
          </div>
          <pre
            class="whitespace-pre-wrap break-words font-sans text-[14px] font-normal leading-[1.45] text-[#1a1a1a]"
          >{{ turn.user.content }}</pre>
        </div>

        <TurnScaffold
          v-if="turn.activity.length"
          :steps="turn.activity"
          :live="turn.running"
        />
        <div
          v-else-if="turn.running && !visibleReplies(turn).length"
          class="text-[13px] text-[#8a8a8a]"
        >
          Working…
        </div>

        <!-- Assistant — borderless prose on panel bg -->
        <div
          v-for="message in visibleReplies(turn)"
          :key="message.id"
          class="group"
        >
          <MarkdownBody
            :key="`${message.id}:${chat.renderEpoch}`"
            :source="message.content"
            :artifact-sources="
              artifactSourcesFor(turn, turnIndex, message.content)
            "
            :auto-open-html="message.streaming === true"
          />
          <div
            v-if="message.streaming"
            class="mt-1.5 text-[12px] text-[#8a8a8a]"
          >
            Writing…
          </div>
          <div
            v-else
            class="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <button
              type="button"
              class="inline-flex h-6 w-6 items-center justify-center rounded text-[#8a8a8a] hover:bg-[#e8e8e8] hover:text-[#3c3c3c]"
              title="Copy"
              @click="copyReply(message.content)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Interactive prompts only on the latest / live turn. -->
        <template
          v-if="
            hasPrompts &&
            (turn.running || turn === chat.turns[chat.turns.length - 1])
          "
        >
          <ApprovalCard
            v-for="req in approvals"
            :key="req.serverRequestId"
            :request="req"
            @choose="(choice) => chat.answerApproval(req.requestId, choice)"
          />
          <ClarifyCard
            v-for="req in clarifies"
            :key="req.serverRequestId"
            :request="req"
            @submit="(answers) => chat.answerClarify(req.serverRequestId, answers)"
            @skip="chat.skipClarify(req.serverRequestId)"
          />
          <SecretPromptCard
            v-for="req in secrets"
            :key="req.serverRequestId"
            :request="req"
            @submit="(value) => chat.answerSecret(req.serverRequestId, value)"
            @cancel="chat.answerSecret(req.serverRequestId, '')"
          />
          <VaultSaveLoginCard
            v-for="req in vaultSaves"
            :key="req.serverRequestId"
            :request="req"
            @submit="(value) => chat.answerVaultSave(req.serverRequestId, value)"
            @cancel="chat.answerVaultSave(req.serverRequestId, '')"
          />
        </template>

        <p
          v-if="
            chat.statusLine &&
            (turn.running || turn === chat.turns[chat.turns.length - 1])
          "
          class="mt-2 text-[12px] text-[#8a8a8a]"
        >
          {{ chat.statusLine }}
        </p>
      </article>
    </div>

    <!-- Prompts when there is no turn chrome yet (edge case). -->
    <div
      v-if="hasPrompts && !chat.turns.length"
      class="mx-auto mt-3 w-full max-w-[680px]"
    >
      <ApprovalCard
        v-for="req in approvals"
        :key="`empty-${req.serverRequestId}`"
        :request="req"
        @choose="(choice) => chat.answerApproval(req.requestId, choice)"
      />
      <ClarifyCard
        v-for="req in clarifies"
        :key="`empty-c-${req.serverRequestId}`"
        :request="req"
        @submit="(answers) => chat.answerClarify(req.serverRequestId, answers)"
        @skip="chat.skipClarify(req.serverRequestId)"
      />
      <SecretPromptCard
        v-for="req in secrets"
        :key="`empty-s-${req.serverRequestId}`"
        :request="req"
        @submit="(value) => chat.answerSecret(req.serverRequestId, value)"
        @cancel="chat.answerSecret(req.serverRequestId, '')"
      />
      <VaultSaveLoginCard
        v-for="req in vaultSaves"
        :key="`empty-v-${req.serverRequestId}`"
        :request="req"
        @submit="(value) => chat.answerVaultSave(req.serverRequestId, value)"
        @cancel="chat.answerVaultSave(req.serverRequestId, '')"
      />
    </div>

    <div
      v-if="chat.error"
      class="mx-auto mt-3 max-w-[680px] text-[13px] text-[#c43c3c]"
    >
      {{ chat.error }}
    </div>
  </div>
</template>
