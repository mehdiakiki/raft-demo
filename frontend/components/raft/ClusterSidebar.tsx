import type { FormEvent } from 'react';
import type { CandidateVoteTally, ConnectionStatus, RaftNode } from '@/hooks/useRaft';
import {
  CLUSTER_STATE_TITLE_CLASS,
  type CommandDispatchStatus,
  ClusterNodeList,
  SIDEBAR_ROOT_CLASS,
  SidebarClientPanel,
  TimeoutDebugPanel,
} from './ClusterSidebar.parts';

interface ClusterSidebarProps {
  commandStatus: CommandDispatchStatus;
  nodes: Record<string, RaftNode>;
  voteTallies: Record<string, CandidateVoteTally>;
  connectionStatus: ConnectionStatus;
  isRunning: boolean;
  commandInput: string;
  setCommandInput: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}

export function ClusterSidebar({
  commandStatus,
  nodes,
  voteTallies,
  connectionStatus,
  isRunning,
  commandInput,
  setCommandInput,
  onSubmit,
}: ClusterSidebarProps) {
  return (
    <div className={SIDEBAR_ROOT_CLASS}>
      <SidebarClientPanel
        commandStatus={commandStatus}
        commandInput={commandInput}
        connectionStatus={connectionStatus}
        isRunning={isRunning}
        nodes={nodes}
        onSubmit={onSubmit}
        setCommandInput={setCommandInput}
      />
      <TimeoutDebugPanel nodes={nodes} />

      <div className={CLUSTER_STATE_TITLE_CLASS}>Cluster State</div>
      <ClusterNodeList nodes={nodes} voteTallies={voteTallies} />
    </div>
  );
}
