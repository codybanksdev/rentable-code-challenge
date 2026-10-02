import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex="0"]';

// The keyboard behaviour a modal dialog owes its user:
// - focus moves to the dialog's heading when it opens,
// - Tab and Shift+Tab stay inside the dialog,
// - Escape closes it,
// - focus goes back to whatever opened it.
// Returns refs for the dialog element and its heading.
export function useDialog(onClose) {
    const dialogRef = useRef(null);
    const headingRef = useRef(null);

    useEffect(() => {
        const opener = document.activeElement;
        headingRef.current.focus();
        return () => {
            if (opener && opener.focus) opener.focus();
        };
    }, []);

    useEffect(() => {
        const onKeyDown = event => {
            if (event.key === 'Escape') {
                onClose();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const inside = dialogRef.current.contains(document.activeElement);
            // Wrap at either end, and pull focus back in if it is on the
            // heading or has escaped to the page behind.
            if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return { dialogRef, headingRef };
}
