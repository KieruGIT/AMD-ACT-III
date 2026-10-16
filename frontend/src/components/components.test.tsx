import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MOCK_CONFIG } from '../api/mockMonitoringClient';
import { initialSession, type SessionState } from '../lib/sessionReducer';
import { AlertList } from './alerts/AlertList';
import { AssessmentCard } from './monitoring/AssessmentCard';

const withResult: SessionState = {
  ...initialSession,
  status: 'interrupted',
  sessionId: 's',
  error: { kind: 'backend', message: 'Backend unreachable' },
  latest: {
    contract_version: '1.0', session_id: 's', machine_id: 'fan_01', sequence: 4,
    recorded_at: new Date().toISOString(), status: 'normal', signal_quality: 'ok',
    anomaly_score: 0.31, threshold: 0.65, score_unit: 'reconstruction_error', is_probability: false,
    is_anomaly_window: false, alert: { triggered: false, event_id: null, reason: null },
    processing: { model_ms: 20, server_ms: 60 }, model_version: 'mock-v1',
  },
};

describe('AssessmentCard', () => {
  it('shows interruption instead of the last green "Normal"', () => {
    render(<AssessmentCard view="interrupted" state={withResult} config={MOCK_CONFIG} activeEvent={null} now={Date.now()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Monitoring interrupted');
    expect(screen.queryByText('Normal')).toBeNull();
    expect(screen.getByText('Last score (not live)')).toBeInTheDocument();
  });

  it('never renders the score as a percentage', () => {
    const { container } = render(
      <AssessmentCard view="normal" state={{ ...withResult, status: 'monitoring', error: null }} config={MOCK_CONFIG} activeEvent={null} now={Date.now()} />,
    );
    expect(container.textContent).not.toMatch(/\d\s*%/);
    expect(screen.getByText('0.310')).toBeInTheDocument();
  });
});

describe('AlertList', () => {
  it('empty state does not claim safety', () => {
    render(<AlertList events={[]} profiles={[]} now={0} onAcknowledge={async () => {}} />);
    expect(screen.getByText('No alerts in this session')).toBeInTheDocument();
  });
});
