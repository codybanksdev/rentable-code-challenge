import React from 'react';

// Black or white text, whichever is readable on the label's colour. Uses the
// WCAG relative-luminance formula, so a custom colour can never produce an
// unreadable chip.
export function readableTextColor(hex) {
    const [red, green, blue] = [1, 3, 5]
        .map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
        .map(channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    return luminance > 0.179 ? '#000000' : '#ffffff';
}

function LabelChip({ label }) {
    return (
        <span
            className="label-chip"
            style={{ backgroundColor: label.color, color: readableTextColor(label.color) }}
        >
            {label.name}
        </span>
    );
}

export default LabelChip;
