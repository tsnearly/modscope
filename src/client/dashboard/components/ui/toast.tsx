import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ToastType = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  exiting?: boolean;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

export const useToast = () => useContext(ToastContext);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type }]);

    // Start exit animation before removal
    setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
      );
    }, 4200);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4700);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 400);
  }, []);

  const typeStyles: Record<ToastType, { bg: string; border: string; icon: string }> = {
    info: {
      bg: 'rgba(37, 99, 235, 0.08)',
      border: 'rgba(37, 99, 235, 0.25)',
      icon: 'ℹ',
    },
    success: {
      bg: 'rgba(34, 197, 94, 0.08)',
      border: 'rgba(34, 197, 94, 0.25)',
      icon: '✓',
    },
    error: {
      bg: 'rgba(239, 68, 68, 0.08)',
      border: 'rgba(239, 68, 68, 0.25)',
      icon: '✕',
    },
  };

  const iconColors: Record<ToastType, string> = {
    info: '#2563eb',
    success: '#22c55e',
    error: '#ef4444',
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {createPortal(
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column-reverse',
            gap: '8px',
            pointerEvents: 'none',
            maxWidth: '380px',
          }}
        >
          {toasts.map((toast) => {
            const style = typeStyles[toast.type];
            return (
              <div
                key={toast.id}
                role="alert"
                onClick={() => dismiss(toast.id)}
                style={{
                  pointerEvents: 'auto',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  background: style.bg,
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  border: `1px solid ${style.border}`,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'var(--color-text, #1e293b)',
                  lineHeight: '1.45',
                  animation: toast.exiting
                    ? 'toast-exit 400ms ease-in forwards'
                    : 'toast-enter 350ms ease-out',
                  opacity: toast.exiting ? 0 : 1,
                  transform: toast.exiting ? 'translateX(120%)' : 'translateX(0)',
                  transition: 'opacity 350ms, transform 350ms',
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#fff',
                    background: iconColors[toast.type],
                    marginTop: '1px',
                  }}
                >
                  {style.icon}
                </span>
                <span style={{ flex: 1 }}>{toast.message}</span>
              </div>
            );
          })}
        </div>,
        document.body
      )}
      <style>{`
        @keyframes toast-enter {
          from {
            opacity: 0;
            transform: translateX(100%) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }
        @keyframes toast-exit {
          from {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateX(120%) scale(0.95);
          }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
