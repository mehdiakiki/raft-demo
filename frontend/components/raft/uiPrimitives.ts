import { cva } from 'class-variance-authority';

// RAFT_SURFACE composes common container styles (panel, card, inset blocks).
export const RAFT_SURFACE = cva('border', {
  variants: {
    // tone controls the base background and border palette.
    tone: {
      elevated: 'bg-[#151619]/90 border-white/10',
      card: 'bg-[#151619] border-white/5',
      inset: 'bg-[#0A0A0B] border-white/5',
    },
    // blur applies optional backdrop blur on translucent surfaces.
    blur: {
      none: '',
      soft: 'backdrop-blur',
    },
    // shadow controls elevation depth.
    shadow: {
      none: '',
      deep: 'shadow-2xl',
    },
    // layout sets an optional inline flex row scaffold.
    layout: {
      none: '',
      row: 'flex items-center',
    },
    // gap defines spacing between row children.
    gap: {
      none: '',
      sm: 'gap-2',
      md: 'gap-3',
      lg: 'gap-4',
    },
    // padding defines internal spacing presets by use case.
    padding: {
      none: '',
      compact: 'p-2',
      card: 'p-4',
      cozy: 'px-4 py-2',
      metric: 'px-2 py-1.5',
    },
    // radius sets border rounding scale.
    radius: {
      none: '',
      md: 'rounded-md',
      lg: 'rounded-lg',
      xl: 'rounded-xl',
      xxl: 'rounded-2xl',
    },
  },
  defaultVariants: {
    blur: 'none',
    shadow: 'none',
    layout: 'none',
    gap: 'none',
    padding: 'none',
    radius: 'none',
  },
});

// RAFT_INTERACTIVE_STANDARD centralizes focus/active/disabled affordances.
export const RAFT_INTERACTIVE_STANDARD = cva(
  'transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0B] disabled:cursor-not-allowed disabled:opacity-40',
  {
    variants: {
      pressable: {
        true: 'active:scale-[0.99]',
        false: '',
      },
    },
    defaultVariants: {
      pressable: false,
    },
  },
);

// RAFT_CONTROL_BUTTON composes shared control-button geometry + tone variants.
export const RAFT_CONTROL_BUTTON = cva(
  `${RAFT_INTERACTIVE_STANDARD({ pressable: true })} flex items-center gap-2 px-6 py-2.5 rounded-xl font-medium text-sm border`,
  {
    variants: {
      // tone maps control intent to its visual treatment.
      tone: {
        running: 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border-amber-500/20',
        paused: 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/20',
        chaosOn: 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.2)]',
        chaosOff: 'bg-white/5 text-slate-300 hover:bg-white/10 border-transparent hover:border-white/10',
        neutral: 'bg-white/5 text-slate-300 hover:bg-white/10 border-transparent hover:border-white/10',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
);

// RAFT_STATUS_BADGE is used for small operational state labels.
export const RAFT_STATUS_BADGE = cva(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-widest',
  {
    variants: {
      tone: {
        neutral: 'bg-white/5 border-white/10 text-slate-300',
        info: 'bg-sky-500/10 border-sky-500/30 text-sky-300',
        success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
        warning: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
        danger: 'bg-red-500/10 border-red-500/30 text-red-300',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
);

// RAFT_STATUS_PANEL is used for inline status/feedback messages.
export const RAFT_STATUS_PANEL = cva(
  'rounded-lg border px-3 py-2 text-[11px] font-mono leading-relaxed',
  {
    variants: {
      tone: {
        neutral: 'bg-white/5 border-white/10 text-slate-300',
        info: 'bg-sky-500/10 border-sky-500/30 text-sky-200',
        success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200',
        warning: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
        danger: 'bg-red-500/10 border-red-500/30 text-red-200',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
);
