import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CirclePause,
  Clock,
  Loader,
  Unplug,
  type LucideIcon,
} from 'lucide-react';
import type { AssessmentView } from './sessionReducer';

export type Tone = 'normal' | 'warning' | 'anomaly' | 'unknown' | 'accent' | 'neutral';

export interface StatusMeta {
  label: string;
  short: string;
  tone: Tone;
  Icon: LucideIcon;
  description: string;
}

export const ASSESSMENT: Record<AssessmentView, StatusMeta> = {
  idle: {
    label: 'Not monitoring',
    short: 'Idle',
    tone: 'neutral',
    Icon: CirclePause,
    description: 'Start monitoring to capture audio and request assessments.',
  },
  initializing: {
    label: 'Initializing',
    short: 'Initializing',
    tone: 'accent',
    Icon: Loader,
    description: 'Capturing the first analysis window. No assessment yet.',
  },
  normal: {
    label: 'Normal',
    short: 'Normal',
    tone: 'normal',
    Icon: CircleCheck,
    description: 'The latest valid window scored below the calibrated threshold. This does not establish mechanical safety.',
  },
  anomaly: {
    label: 'Abnormal acoustic pattern',
    short: 'Abnormal',
    tone: 'anomaly',
    Icon: CircleAlert,
    description: 'The latest window scored above the threshold. A single window is not an alert on its own.',
  },
  unable_to_assess: {
    label: 'Unable to assess',
    short: 'Unable to assess',
    tone: 'unknown',
    Icon: CircleHelp,
    description: 'Signal quality is inadequate for a confident assessment.',
  },
  interrupted: {
    label: 'Monitoring interrupted',
    short: 'Interrupted',
    tone: 'warning',
    Icon: Unplug,
    description: 'No current assessment. The previous reading is not live.',
  },
  stale: {
    label: 'Data stale',
    short: 'Stale',
    tone: 'warning',
    Icon: Clock,
    description: 'No new result has arrived recently. The last reading is no longer live.',
  },
  stopped: {
    label: 'Stopped',
    short: 'Stopped',
    tone: 'neutral',
    Icon: CircleDashed,
    description: 'Capture is off. Charts show this session as history.',
  },
};

export const QUALITY_LABEL: Record<string, string> = {
  ok: 'OK',
  silence: 'Silence',
  clipping: 'Clipping',
  noisy: 'Too noisy',
  unsupported: 'Unsupported',
  unknown: 'Unknown',
};

