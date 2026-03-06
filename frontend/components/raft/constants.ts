import type { LegacyMessageType } from '@/hooks/useRaft';
import type { NodeState } from '@/lib/types';

// NODE_IDS defines the fixed node labels rendered in the demo ring.
export const NODE_IDS = ['A', 'B', 'C', 'D', 'E'] as const;

// RADIUS is the distance from center to each node position.
export const RADIUS = 220;

// CENTER is the midpoint (x,y) of the circular canvas.
export const CENTER = 300;

export type NodePositions = Record<string, { x: number; y: number }>;

// getNodePosition computes a node's Cartesian coordinates on the ring.
export function getNodePosition(index: number, total: number) {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  return {
    x: CENTER + RADIUS * Math.cos(angle),
    y: CENTER + RADIUS * Math.sin(angle),
  };
}

// STATE_COLORS maps backend node role to its card color treatment.
export const STATE_COLORS: Record<NodeState, string> = {
  FOLLOWER: 'bg-[#151619] border-[#2A2B32] text-slate-300',
  CANDIDATE: 'bg-[#2A2010] border-[#5A4010] text-yellow-500',
  LEADER: 'bg-[#102A1A] border-[#105A30] text-emerald-400',
  DEAD: 'bg-[#1A1010] border-[#3A1010] text-red-500 opacity-40',
};

// MSG_COLORS maps legacy RPC animation type to pulse color.
export const MSG_COLORS: Record<LegacyMessageType, string> = {
  PRE_VOTE: 'bg-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.5)]',
  PRE_VOTE_REPLY: 'bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.5)]',
  REQUEST_VOTE: 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]',
  VOTE_REPLY: 'bg-yellow-300 shadow-[0_0_8px_rgba(253,224,71,0.5)]',
  APPEND_ENTRIES: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]',
  APPEND_REPLY: 'bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.5)]',
};

// RADIAL_GUIDE_STROKE_WIDTH is the center-to-node guide line thickness.
export const RADIAL_GUIDE_STROKE_WIDTH = 1;

// RADIAL_GUIDE_DASHARRAY defines the SVG dash pattern for guide lines.
export const RADIAL_GUIDE_DASHARRAY = '4 4';

// ELECTION_RING_CENTER is the SVG center coordinate for election rings.
export const ELECTION_RING_CENTER = 60;

// ELECTION_RING_RADIUS is the follower/candidate progress ring radius.
export const ELECTION_RING_RADIUS = 58;

// ELECTION_RING_STROKE_WIDTH is the ring stroke thickness.
export const ELECTION_RING_STROKE_WIDTH = 2;

// ELECTION_RING_CIRCUMFERENCE is 2πr for r=58, used for dash math.
export const ELECTION_RING_CIRCUMFERENCE = 364.42;

// NETWORK_LATENCY_SLIDER_MIN is the minimum slider thumb value.
export const NETWORK_LATENCY_SLIDER_MIN = 0.005;

// NETWORK_LATENCY_SLIDER_MAX is the maximum slider thumb value.
export const NETWORK_LATENCY_SLIDER_MAX = 0.05;

// NETWORK_LATENCY_SLIDER_STEP is the slider increment granularity.
export const NETWORK_LATENCY_SLIDER_STEP = 0.005;

// NETWORK_LATENCY_INVERT_BASE maps slider value to messageSpeed.
export const NETWORK_LATENCY_INVERT_BASE = 0.055;

// NETWORK_LATENCY_PERCENT_SCALE converts normalized latency to UI percent.
export const NETWORK_LATENCY_PERCENT_SCALE = 100;
