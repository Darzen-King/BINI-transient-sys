// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button, Field, Notice, ResponsiveDialog, SectionCard } from '../src/design-system/index.js';

afterEach(() => cleanup());

describe('BINI design system core components', () => {
  it('exposes consistent button variants and loading semantics', () => {
    render(<Button loading>儲存</Button>);
    const button = screen.getByRole('button', { name: '儲存' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveClass('bds-button--primary');
  });

  it('associates field labels and validation messages with their controls', () => {
    render(<Field error="必填" label="房號"><input /></Field>);
    const input = screen.getByRole('textbox', { name: '房號' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('必填');
  });

  it('renders notice and section semantics without product-specific markup', () => {
    render(<SectionCard hint="3 筆" title="預約"><Notice title="同步完成" tone="success" /></SectionCard>);
    expect(screen.getByRole('heading', { name: '預約' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('同步完成');
  });

  it('closes dialogs with Escape', () => {
    const close = vi.fn();
    render(<><button>開啟</button><ResponsiveDialog onClose={close} title="房間詳細資料"><button>主要操作</button></ResponsiveDialog></>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog', { name: '房間詳細資料' })).toBeInTheDocument();
  });
});
