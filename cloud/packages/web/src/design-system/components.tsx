import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';

const classes = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  leadingIcon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  leadingIcon,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={classes('bds-button', `bds-button--${variant}`, `bds-button--${size}`, block && 'bds-button--block', className)}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? <span aria-hidden="true" className="bds-button__spinner" /> : leadingIcon}
      {children}
    </button>
  );
}

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({ tone = 'neutral', className, children }: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={classes('bds-badge', `bds-badge--${tone}`, className)}>{children}</span>;
}

export function SectionCard({ title, hint, actions, className, children, ...props }: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <section className={classes('bds-section', 'section-card', className)} {...props}>
      <div className="bds-section__heading section-heading">
        <h2>{title}</h2>
        {actions ?? (hint ? <span className="bds-section__hint">{hint}</span> : null)}
      </div>
      {children}
    </section>
  );
}

type FieldControlProps = {
  className?: string;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

export function Field({ label, hint, error, className, children }: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactElement<FieldControlProps>;
}) {
  const generatedId = useId();
  const controlId = children.props.id ?? `${generatedId}-control`;
  const descriptionId = hint || error ? `${generatedId}-description` : undefined;
  const controlProps: FieldControlProps = {
    id: controlId,
    className: classes('bds-field-control', children.props.className),
  };
  if (descriptionId) controlProps['aria-describedby'] = descriptionId;
  if (error) controlProps['aria-invalid'] = true;
  const control = isValidElement(children) ? cloneElement(children, controlProps) : children;

  return (
    <div className={classes('bds-field', className)}>
      <label className="bds-field__label" htmlFor={controlId}>{label}</label>
      {control}
      {hint || error ? <span className={error ? 'bds-field__error' : 'bds-field__hint'} id={descriptionId}>{error ?? hint}</span> : null}
    </div>
  );
}

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const noticeIcons: Record<NoticeTone, string> = { info: 'i', success: '✓', warning: '!', danger: '×' };

export function Notice({ tone = 'info', title, children, className, role }: {
  tone?: NoticeTone;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: 'status' | 'alert';
}) {
  return (
    <div className={classes('bds-notice', `bds-notice--${tone}`, className)} role={role ?? (tone === 'danger' ? 'alert' : 'status')}>
      <span aria-hidden="true" className="bds-notice__icon">{noticeIcons[tone]}</span>
      <span><strong className="bds-notice__title">{title}</strong>{children ? <span className="bds-notice__body">{children}</span> : null}</span>
    </div>
  );
}

const focusableSelector = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function ResponsiveDialog({ title, description, onClose, className, children }: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = dialogRef.current;
    const firstFocusable = dialog?.querySelector<HTMLElement>(focusableSelector);
    firstFocusable?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="bds-dialog-backdrop modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={classes('bds-dialog', 'bottom-sheet', className)}
        ref={dialogRef}
        role="dialog"
      >
        <div aria-hidden="true" className="bds-dialog__handle sheet-handle" />
        <header className="bds-dialog__header sheet-title">
          <div><h2 className="bds-dialog__title" id={titleId}>{title}</h2>{description ? <p className="bds-dialog__description" id={descriptionId}>{description}</p> : null}</div>
          <Button aria-label="關閉" className="bds-dialog__close" onClick={onClose} size="icon" variant="ghost">×</Button>
        </header>
        {children}
      </section>
    </div>
  );
}
