import { useEffect, useMemo, useState } from "react";
import { useChatStore, NEW_CHAT_DRAFT_KEY } from "../../stores/chat";
import { AttachmentChips } from "./AttachmentChips";
import { ComposerErrorBanner } from "./ComposerErrorBanner";
import { ComposerTextarea } from "./ComposerTextarea";
import { FollowUpActions } from "./FollowUpActions";
import { ImageGenModal } from "./ImageGenModal";
import { ModelBadge } from "./ModelBadge";
import { PlusMenu } from "./PlusMenu";
import { SendButton } from "./SendButton";
import { SkillPicker } from "./SkillPicker";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { useComposer } from "./hooks/useComposer";

const EMPTY_SKILLS: string[] = [];

export function InputBar({ onOpenSettings }: { onOpenSettings?: () => void } = {}) {
  const activeId = useChatStore((s) => s.activeId);
  const focusNonce = useChatStore((s) => s.focusNonce);
  const isFollowUp = useChatStore((s) => (s.activeId ? (s.messages[s.activeId]?.length ?? 0) > 0 : false));
  const isStreaming = useChatStore((s) => activeId ? s.isConversationStreaming(activeId) : false);
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const providerConfigs = useChatStore((s) => s.providerConfigs);
  const providerHealth = useChatStore((s) => s.providerHealth);
  const discoveredModels = useChatStore((s) => s.discoveredModels);
  const modelOverrides = useChatStore((s) => s.modelOverrides);
  const models = useMemo(() => useChatStore.getState().getModels(), [
    providerConfigs,
    providerHealth,
    discoveredModels,
    modelOverrides,
  ]);
  const agentMode = useChatStore((s) => s.agentMode);
  const designMode = useChatStore((s) => s.designMode);
  const planMode = useChatStore((s) => s.planMode);
  const researchMode = useChatStore((s) => s.researchMode);
  const pursueGoalMode = useChatStore((s) => s.pursueGoalMode);
  const tavilyApiKey = useChatStore((s) => s.tavilyApiKey);
  const searchBackend = useChatStore((s) => s.searchBackend);
  const featureFlags = useChatStore((s) => s.featureFlags);
  const animatedBorderEnabled = useChatStore((s) => s.animatedBorderEnabled);
  const plusMenuVisibility = useChatStore((s) => s.plusMenuVisibility);
  const voiceSettings = useChatStore((s) => s.voiceSettings);
  const pendingDroppedFiles = useChatStore((s) => s.pendingDroppedFiles);
  const pendingFormSubmission = useChatStore((s) => s.pendingFormSubmission);
  const resendPayload = useChatStore((s) => s.resendPayload);
  const steerPayload = useChatStore((s) => s.steerPayload);
  const messageQueue = useChatStore((s) => s.messageQueue);
  const discoveredSkills = useChatStore((s) => s.discoveredSkills);
  const disabledSkills = useChatStore((s) => s.disabledSkills);
  const activeSkillNames = useChatStore((s) => {
    if (!s.activeId) return EMPTY_SKILLS;
    return s.conversations.find((conversation) => conversation.id === s.activeId)?.activeSkillNames ?? EMPTY_SKILLS;
  });
  const imageGenSettings = useChatStore((s) => s.imageGenSettings);
  const addImageArtifact = useChatStore((s) => s.addImageArtifact);
  const cancelStreaming = useChatStore((s) => s.cancelStreaming);
  const clearPendingDroppedFiles = useChatStore((s) => s.clearPendingDroppedFiles);
  const setPendingFormSubmission = useChatStore((s) => s.setPendingFormSubmission);
  const addMessage = useChatStore((s) => s.addMessage);
  const clearResend = useChatStore((s) => s.clearResend);
  const beginQueuedMessageDispatch = useChatStore((s) => s.beginQueuedMessageDispatch);
  const finishQueuedMessageDispatch = useChatStore((s) => s.finishQueuedMessageDispatch);
  const setSteerPayload = useChatStore((s) => s.setSteerPayload);
  const setPursueGoalMode = useChatStore((s) => s.setPursueGoalMode);
  const setPlanMode = useChatStore((s) => s.setPlanMode);
  const toggleResearchMode = useChatStore((s) => s.toggleResearchMode);
  const setConversationSkills = useChatStore((s) => s.setConversationSkills);
  const fileRefActiveWorkspace = useChatStore((s) => s.agentMode ? s.workspacePath : s.designMode ? s.designWorkspacePath : null);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showSkillPicker, setShowSkillPicker] = useState(false);

  const composer = useComposer({ getStore: useChatStore.getState, activeId, selectedModelId, isStreaming, voiceSettings });
  const noModelsAvailable = models.filter((model) => model.isAvailable).length === 0;
  const canSend = (composer.value.trim().length > 0 || composer.files.length > 0) && !noModelsAvailable && !!selectedModelId;
  const activeModeKey = agentMode ? "agent" : designMode ? "design" : "chat";
  const searchAvailable = searchBackend === "tavily" ? !!tavilyApiKey : true;

  const skillsForCurrentMode = useMemo(() => discoveredSkills.filter((skill) => {
    if (skill.mode === "both") return true;
    return agentMode ? skill.mode === "agent" : skill.mode === "chat";
  }), [agentMode, discoveredSkills]);

  const { appendFiles, error, files, focus, handleAttach, handleFilesChange, handlePaste, handleRemoveFile, handleToggleMic, loadDraft, pendingSkills, recallPreviousUserMessage, send, sendRef, setError, setPendingSkills, setValue, showMic, speech, textareaRef, value, fileInputRef } = composer;

  useEffect(() => {
    loadDraft(activeId ?? NEW_CHAT_DRAFT_KEY);
    focus();
  }, [activeId, focusNonce, focus, loadDraft]);

  useEffect(() => {
    if (!error) return;
    const isCancellation = /cancel|abort|stopped|interrupt/i.test(error);
    const timeout = setTimeout(() => setError(null), isCancellation ? 1500 : 6000);
    return () => clearTimeout(timeout);
  }, [error, setError]);

  useEffect(() => {
    if (pendingDroppedFiles.length === 0) return;
    appendFiles(pendingDroppedFiles);
    clearPendingDroppedFiles();
    focus();
  }, [appendFiles, clearPendingDroppedFiles, focus, pendingDroppedFiles]);

  useEffect(() => {
    if (!pendingFormSubmission || pendingFormSubmission.conversationId !== activeId) return;
    const text = pendingFormSubmission.text;
    setPendingFormSubmission(null);
    addMessage({
      conversationId: activeId,
      role: "user",
      content: text,
      modelId: selectedModelId ?? undefined,
    });
    setTimeout(() => sendRef.current?.({ content: text }), 0);
  }, [activeId, addMessage, pendingFormSubmission, selectedModelId, sendRef, setPendingFormSubmission]);

  useEffect(() => {
    if (!resendPayload) return;
    if (resendPayload.conversationId !== activeId) {
      clearResend();
      return;
    }
    clearResend();
    send({ content: resendPayload.content, attachments: resendPayload.attachments });
  }, [activeId, clearResend, resendPayload, send]);

  useEffect(() => {
    if (!steerPayload || steerPayload.conversationId !== activeId) return;
    const { content, steered } = steerPayload;
    const conversationId = steerPayload.conversationId;
    setSteerPayload(null);
    void send({ content, fromQueue: true, steered })
      .catch((error) => setError(error instanceof Error ? error.message : "Unable to send queued message."))
      .finally(() => finishQueuedMessageDispatch(conversationId));
  }, [activeId, finishQueuedMessageDispatch, send, setError, setSteerPayload, steerPayload]);

  useEffect(() => {
    if (!activeId || isStreaming || steerPayload) return;
    if (!messageQueue[activeId]?.length) return;
    const next = beginQueuedMessageDispatch(activeId);
    if (next) setSteerPayload({ conversationId: activeId, content: next.content, steered: false });
  }, [activeId, beginQueuedMessageDispatch, isStreaming, messageQueue, setSteerPayload, steerPayload]);

  return (
    <ImageGenModal providerConfigs={providerConfigs} imageGenSettings={imageGenSettings} activeId={activeId} addImageArtifact={addImageArtifact}>
      {({ open: openImageGen }) => (
      <div className="w-full max-w-[720px] min-w-0">
      <div className={["composer-surface relative w-full min-w-0 rounded-[24px]", animatedBorderEnabled ? "animated-border" : "", showPlusMenu || showSkillPicker ? "z-[95]" : "", isFollowUp ? "px-5 py-3" : "min-h-[154px] p-5 max-[520px]:min-h-[146px] max-[520px]:p-4", "transition-[border-color,box-shadow,transform,background] duration-200 focus-within:border-white/[0.14] focus-within:shadow-[0_26px_80px_-38px_rgba(0,0,0,0.98),0_0_0_4px_rgba(var(--theme-accent-rgb),0.07),inset_0_1px_0_rgba(255,255,255,0.08)] focus-within:-translate-y-px"].join(" ")}>
        {animatedBorderEnabled && (
          <div className="pointer-events-none absolute inset-0 rounded-[24px]" style={{ zIndex: 10 }}>
            <svg className="absolute inset-0 w-full h-full" style={{ overflow: "visible" }}>
              <rect
                x="0"
                y="0"
                width="100%"
                height="100%"
                rx="24"
                ry="24"
                fill="none"
                className="animate-border-beam"
                pathLength="100"
              />
            </svg>
          </div>
        )}
        <ComposerErrorBanner message={error} onDismiss={() => setError(null)} />
        <AttachmentChips files={files} onRemove={handleRemoveFile} />
        <SkillPicker open={false} activeId={activeId} activeSkillNames={activeSkillNames} pendingSkills={pendingSkills} skillsForCurrentMode={skillsForCurrentMode} discoveredSkillCount={discoveredSkills.length} disabledSkills={disabledSkills} agentMode={agentMode} onPendingSkillsChange={setPendingSkills} onConversationSkillsChange={setConversationSkills} onClose={() => setShowSkillPicker(false)} />
        <ComposerTextarea value={value} isFollowUp={isFollowUp} isStreaming={isStreaming} noModelsAvailable={noModelsAvailable} agentMode={agentMode} designMode={designMode} speechListening={speech.listening} fileReferenceWorkspace={fileRefActiveWorkspace} textareaRef={textareaRef} onChange={setValue} onSubmit={() => send()} onHistoryRecall={recallPreviousUserMessage} onPaste={handlePaste} />
        <SlashCommandMenu commands={[]} />
        <div className={["flex flex-wrap items-center justify-between gap-2", isFollowUp ? "mt-2.5 pt-2.5" : "mt-4 min-h-[40px] pt-3", "border-t border-white/5"].join(" ")}>
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            {!designMode && (
              <div className="relative">
                <PlusMenu open={showPlusMenu} activeModeKey={activeModeKey} agentMode={agentMode} designMode={designMode} featureFlags={featureFlags} plusMenuVisibility={plusMenuVisibility} pursueGoalMode={pursueGoalMode} planMode={planMode} researchMode={researchMode} searchAvailable={searchAvailable} showSkills={skillsForCurrentMode.length > 0} onOpenChange={setShowPlusMenu} onAttach={handleAttach} onTogglePursueGoal={() => setPursueGoalMode(!pursueGoalMode)} onOpenImageGen={openImageGen} onTogglePlanMode={() => setPlanMode(!planMode)} onToggleResearchMode={toggleResearchMode} onOpenSkills={() => { setPendingSkills(activeId ? activeSkillNames : pendingSkills); setShowSkillPicker((open) => !open); }} />
                <SkillPicker open={showSkillPicker} showChips={false} activeId={activeId} activeSkillNames={activeSkillNames} pendingSkills={pendingSkills} skillsForCurrentMode={skillsForCurrentMode} discoveredSkillCount={discoveredSkills.length} disabledSkills={disabledSkills} agentMode={agentMode} onPendingSkillsChange={setPendingSkills} onConversationSkillsChange={setConversationSkills} onClose={() => setShowSkillPicker(false)} />
              </div>
            )}
            <FollowUpActions fileInputRef={fileInputRef} onFilesChange={handleFilesChange} showMic={showMic} speechListening={speech.listening} onToggleMic={handleToggleMic} designMode={designMode} activeId={activeId} agentMode={agentMode} planMode={planMode} onDisablePlanMode={() => setPlanMode(false)} />
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1 text-[13px] max-[520px]:basis-full max-[520px]:justify-between">
            <ModelBadge onOpenSettings={onOpenSettings} />
            <SendButton value={value} canSend={canSend} isStreaming={isStreaming} onSend={() => send()} onCancel={cancelStreaming} />
          </div>
        </div>
      </div>
      </div>
      )}
    </ImageGenModal>
  );
}
