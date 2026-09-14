// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DateTimeInput, Field, NumberStepper, PasswordInput } from '../src/design-system/index.js';

afterEach(cleanup);

describe('form controls', () => {
  it('shows the check-in time as YYYY-MM-DD HH:mm while keeping a labelled native picker', () => {
    function Harness() { const [value, setValue] = useState(''); return <Field label="入住時間"><DateTimeInput onChange={(event) => setValue(event.target.value)} value={value} /></Field>; }
    const { container } = render(<Harness />);
    const input = screen.getByLabelText('入住時間');
    expect(input).toHaveAttribute('type', 'datetime-local');
    expect(container.querySelector('.bds-datetime__display')).toHaveTextContent('YYYY-MM-DD HH:mm');
    fireEvent.change(input, { target: { value: '2026-09-14T08:36' } });
    expect(container.querySelector('.bds-datetime__display')).toHaveTextContent('2026-09-14 08:36');
  });

  it('keeps uncontrolled form values for FormData submissions', () => {
    const { container } = render(<form><Field label="開始時間"><DateTimeInput name="startAt" /></Field></form>);
    fireEvent.change(screen.getByLabelText('開始時間'), { target: { value: '2026-09-20T10:00' } });
    expect(new FormData(container.querySelector('form')!).get('startAt')).toBe('2026-09-20T10:00');
    expect(container.querySelector('.bds-datetime__display')).toHaveTextContent('2026-09-20 10:00');
  });

  it('steps days by one within the allowed range', () => {
    function Harness() { const [days, setDays] = useState(1); return <Field label="天數"><NumberStepper decrementLabel="減少 1 天" incrementLabel="增加 1 天" max={3} min={1} onChange={setDays} value={days} /></Field>; }
    render(<Harness />);
    const input = screen.getByLabelText('天數');
    expect(screen.getByRole('button', { name: '減少 1 天' })).toBeDisabled();
    for (let index = 0; index < 4; index += 1) fireEvent.click(screen.getByRole('button', { name: '增加 1 天' }));
    expect(input).toHaveValue(3);
    expect(screen.getByRole('button', { name: '增加 1 天' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '減少 1 天' }));
    expect(input).toHaveValue(2);
  });

  it('reveals and hides a typed password with the eye button', () => {
    function Harness() { const [value, setValue] = useState(''); return <Field label="初始密碼"><PasswordInput hideLabel="隱藏密碼" onChange={(event) => setValue(event.target.value)} showLabel="顯示密碼" value={value} /></Field>; }
    render(<Harness />);
    const input = screen.getByLabelText('初始密碼');
    fireEvent.change(input, { target: { value: 'abcd1234' } });
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: '顯示密碼' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('abcd1234');
    fireEvent.click(screen.getByRole('button', { name: '隱藏密碼' }));
    expect(input).toHaveAttribute('type', 'password');
  });
});

