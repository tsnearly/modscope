import React from 'react';

interface FlairBadgeProps {
  text?: string | null | undefined;
  emojis?: Record<string, string> | null | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  imageClassName?: string | undefined;
  imageSize?: number | undefined;
  inlineOnly?: boolean | undefined;
}

/**
 * Parses a flair string containing shortcodes like `:shortcode:`
 * and renders inline images for custom emojis resolved from the provided emoji map.
 */
export function renderFlairWithEmojis(
  text: string | null | undefined,
  emojis?: Record<string, string> | null,
  imageSize = 14,
  imageClassName = ''
): React.ReactNode {
  if (!text) return null;

  // Match :shortcode: pattern
  const emojiRegex = /:([a-zA-Z0-9_-]+):/g;
  if (!emojiRegex.test(text)) {
    return text;
  }
  emojiRegex.lastIndex = 0;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = emojiRegex.exec(text)) !== null) {
    const fullMatch = match[0]; // e.g. ":custom_emoji:"
    const code = match[1] || ''; // e.g. "custom_emoji"
    const lowerCode = code.toLowerCase();

    let url: string | undefined = undefined;
    if (emojis && Object.keys(emojis).length > 0) {
      url =
        (code ? emojis[code] : undefined) ||
        (lowerCode ? emojis[lowerCode] : undefined) ||
        emojis[fullMatch] ||
        emojis[`:${lowerCode}:`];
    }

    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${lastIndex}`} className="truncate">
          {text.substring(lastIndex, match.index)}
        </span>
      );
    }

    if (url) {
      const cleanUrl = url.replace(/&amp;/g, '&');
      parts.push(
        <img
          key={`emoji-${match.index}`}
          src={cleanUrl}
          alt={fullMatch}
          title={fullMatch}
          className={`inline-block object-contain flex-shrink-0 ${imageClassName}`}
          style={{
            width: imageSize,
            height: imageSize,
            verticalAlign: 'middle',
            marginRight: 4,
            display: 'inline-block',
          }}
          loading="lazy"
        />
      );
    } else {
      parts.push(fullMatch);
    }

    lastIndex = emojiRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(
      <span key={`text-${lastIndex}`} className="truncate">
        {text.substring(lastIndex)}
      </span>
    );
  }

  return parts.length > 0 ? parts : text;
}

export const FlairBadge: React.FC<FlairBadgeProps> = ({
  text,
  emojis,
  className = '',
  style,
  imageClassName = '',
  imageSize = 13,
  inlineOnly = false,
}) => {
  if (!text) return null;

  const content = renderFlairWithEmojis(
    text,
    emojis,
    imageSize,
    imageClassName
  );

  if (inlineOnly) {
    return (
      <span className={className} style={style}>
        {content}
      </span>
    );
  }

  const defaultStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 6px',
    background: '#f1f5f9',
    fontSize: '9px',
    borderRadius: '3px',
    color: '#64748b',
    whiteSpace: 'nowrap',
    fontWeight: 500,
    maxWidth: '100%',
    ...style,
  };

  return (
    <span
      className={`modscope-flair-badge ${className}`}
      style={defaultStyle}
      title={text}
    >
      {content}
    </span>
  );
};
