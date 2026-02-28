'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRaft } from '@/hooks/useRaft';
import type { RaftNode } from '@/hooks/useRaft';
import { ClusterCanvas } from './raft/ClusterCanvas';
import { ClusterSidebar } from './raft/ClusterSidebar';
import type { CommandDispatchStatus } from './raft/ClusterSidebar.parts';
import { ConnectionOverlay } from './raft/ConnectionOverlay';
import { getNodePosition, NODE_IDS, type NodePositions } from './raft/constants';

interface ClusterLayoutProps {
  chaosMode: boolean;
  commandStatus: CommandDispatchStatus;
  commandInput: string;
  connectionStatus: ReturnType<typeof useRaft>['status'];
  heartbeats: ReturnType<typeof useRaft>['heartbeats'];
  isRunning: boolean;
  messageSpeed: number;
  messages: ReturnType<typeof useRaft>['messages'];
  nodePositions: NodePositions;
  nodes: Record<string, RaftNode>;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  reset: () => void;
  setChaosMode: (enabled: boolean) => void;
  setCommandInput: (value: string) => void;
  setIsRunning: (running: boolean) => void;
  setMessageSpeed: (speed: number) => void;
  toggleNodeState: (id: string) => void;
}

const VISUALIZER_ROOT_CLASS =
  'flex flex-col lg:flex-row min-h-screen bg-[#0A0A0B] text-slate-300 font-sans selection:bg-emerald-500/30';
const EMPTY_COMMAND_ERROR_MESSAGE = 'Command is empty. Enter a command such as SET x=5.';
const SUCCESS_STATUS_RESET_MS = 2_500;

interface CommandSubmitReadiness {
  canSubmit: boolean;
  leaderID: string | null;
  reason: string;
}

function buildNodePositions(): NodePositions {
  const positions: NodePositions = {};
  NODE_IDS.forEach((id, i) => {
    positions[id] = getNodePosition(i, NODE_IDS.length);
  });
  return positions;
}

function hasClusterState(nodes: Record<string, RaftNode>): boolean {
  return Object.keys(nodes).length > 0;
}

function commandSubmitReadiness(
  nodes: Record<string, RaftNode>,
  isRunning: boolean,
  connectionStatus: ReturnType<typeof useRaft>['status'],
): CommandSubmitReadiness {
  if (connectionStatus !== 'connected') {
    return {
      canSubmit: false,
      leaderID: null,
      reason: 'Gateway is not connected. Wait for cluster stream to recover.',
    };
  }
  if (!isRunning) {
    return { canSubmit: false, leaderID: null, reason: 'Simulation is paused. Resume before submitting commands.' };
  }

  const leaderEntry = Object.entries(nodes).find(([, node]) => node.actualState === 'LEADER' && !node.stale);
  if (!leaderEntry) {
    return { canSubmit: false, leaderID: null, reason: 'No healthy leader available to accept commands.' };
  }

  return { canSubmit: true, leaderID: leaderEntry[0], reason: '' };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'Command request failed unexpectedly.';
}

function ClusterLayout({
  chaosMode,
  commandStatus,
  commandInput,
  connectionStatus,
  heartbeats,
  isRunning,
  messageSpeed,
  messages,
  nodePositions,
  nodes,
  onSubmit,
  reset,
  setChaosMode,
  setCommandInput,
  setIsRunning,
  setMessageSpeed,
  toggleNodeState,
}: ClusterLayoutProps) {
  return (
    <div className={VISUALIZER_ROOT_CLASS}>
      <ClusterCanvas
        nodes={nodes}
        heartbeats={heartbeats}
        messages={messages}
        nodePositions={nodePositions}
        isRunning={isRunning}
        setIsRunning={setIsRunning}
        toggleNodeState={toggleNodeState}
        reset={reset}
        messageSpeed={messageSpeed}
        setMessageSpeed={setMessageSpeed}
        chaosMode={chaosMode}
        setChaosMode={setChaosMode}
      />

      <ClusterSidebar
        commandStatus={commandStatus}
        nodes={nodes}
        connectionStatus={connectionStatus}
        isRunning={isRunning}
        commandInput={commandInput}
        setCommandInput={setCommandInput}
        onSubmit={onSubmit}
      />
    </div>
  );
}

export default function RaftVisualizer() {
  const {
    nodes,
    status,
    messages,
    heartbeats,
    isRunning,
    setIsRunning,
    toggleNodeState,
    clientRequest,
    reset,
    messageSpeed,
    setMessageSpeed,
    chaosMode,
    setChaosMode,
  } = useRaft();

  const [commandInput, setCommandInput] = useState('');
  const [commandStatus, setCommandStatus] = useState<CommandDispatchStatus>({
    state: 'idle',
    message: '',
  });

  const nodePositions = useMemo(() => buildNodePositions(), []);

  useEffect(() => {
    if (commandStatus.state !== 'success') return;
    const timeoutID = window.setTimeout(() => {
      setCommandStatus({ state: 'idle', message: '' });
    }, SUCCESS_STATUS_RESET_MS);
    return () => window.clearTimeout(timeoutID);
  }, [commandStatus.state]);

  const handleSend = useCallback(async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const cmd = commandInput.trim();
    if (!cmd) {
      setCommandStatus({ state: 'error', message: EMPTY_COMMAND_ERROR_MESSAGE });
      return;
    }

    const readiness = commandSubmitReadiness(nodes, isRunning, status);
    if (!readiness.canSubmit) {
      setCommandStatus({ state: 'error', message: readiness.reason });
      return;
    }

    const leaderLabel = readiness.leaderID ? `N-${readiness.leaderID}` : 'cluster leader';
    setCommandStatus({
      state: 'submitting',
      message: `Submitting command to ${leaderLabel}...`,
    });

    try {
      const result = await clientRequest(cmd);
      const resultLeaderLabel = result.leader_id ? `N-${result.leader_id}` : leaderLabel;
      const duplicateSuffix = result.duplicate ? ' (deduplicated)' : '';
      setCommandStatus({
        state: 'success',
        message: `Command accepted by ${resultLeaderLabel}${duplicateSuffix}.`,
      });
      setCommandInput('');
    } catch (error) {
      setCommandStatus({ state: 'error', message: toErrorMessage(error) });
    }
  }, [clientRequest, commandInput, isRunning, nodes, status]);

  if (!hasClusterState(nodes)) {
    return <ConnectionOverlay status={status} />;
  }

  return (
    <ClusterLayout
      chaosMode={chaosMode}
      commandStatus={commandStatus}
      commandInput={commandInput}
      connectionStatus={status}
      heartbeats={heartbeats}
      isRunning={isRunning}
      messageSpeed={messageSpeed}
      messages={messages}
      nodePositions={nodePositions}
      nodes={nodes}
      onSubmit={handleSend}
      reset={reset}
      setChaosMode={setChaosMode}
      setCommandInput={setCommandInput}
      setIsRunning={setIsRunning}
      setMessageSpeed={setMessageSpeed}
      toggleNodeState={toggleNodeState}
    />
  );
}
