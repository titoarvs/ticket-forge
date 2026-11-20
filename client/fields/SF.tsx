'use client';
import { isValidElement, type ReactNode, Children, Fragment, useState, cloneElement } from 'react';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import ListSubheader from '@mui/material/ListSubheader';
import Checkbox from '@mui/material/Checkbox';
import Radio from '@mui/material/Radio';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import { I } from '../icons';
import { readableOn, type Any } from '../core';

export const ico = (svg: string) => (
  <span className="ico" dangerouslySetInnerHTML={{ __html: svg }} />
);
// Looks: "ghost" = borderless until hover/focus (Jira inline edit), "title" = large ghost heading,
// "bare" = no chrome (inside inline forms), "filter" = compact toolbar dropdown, "loz" = status
// pill.
export const ghost = {
  '& .MuiOutlinedInput-root': { backgroundColor: 'transparent' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
  '& .MuiOutlinedInput-root:hover': { backgroundColor: 'var(--hover)' },
  '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
  '& .MuiOutlinedInput-root.Mui-focused': { backgroundColor: 'var(--bg)' },
  '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: 'var(--border-focus)',
  },
  '& .MuiOutlinedInput-root.Mui-disabled': { backgroundColor: 'transparent' },
  '& .MuiOutlinedInput-root.Mui-disabled .MuiOutlinedInput-notchedOutline': {
    borderColor: 'transparent',
  },
  '& .MuiInputBase-input.Mui-disabled': {
    WebkitTextFillColor: 'var(--text)',
    color: 'var(--text)',
  },
};
const titleLook = {
  ...ghost,
  '& .MuiInputBase-root': { fontSize: 24, lineHeight: '28px', fontWeight: 500, ml: '-6px' },
};
const bare = {
  '& .MuiOutlinedInput-root, & .MuiOutlinedInput-root:hover, & .MuiOutlinedInput-root.Mui-focused':
    { backgroundColor: 'transparent' },
  '& .MuiOutlinedInput-notchedOutline, & .Mui-focused .MuiOutlinedInput-notchedOutline': {
    border: 'none',
  },
};
const mono = {
  '& .MuiInputBase-input': {
    fontFamily: 'var(--mono)',
    fontSize: 12.5,
    lineHeight: 1.55,
    whiteSpace: 'pre',
    tabSize: 2,
  },
};
const filterLook = {
  width: 'auto',
  maxWidth: 200,
  minWidth: 0,
  '& .MuiOutlinedInput-root': {
    backgroundColor: 'var(--bg-neutral)',
    fontWeight: 500,
    color: 'var(--text-subtle)',
  },
  '& .MuiOutlinedInput-root:hover': { backgroundColor: 'var(--bg-neutral-2)' },
  '& .MuiOutlinedInput-notchedOutline, & .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline':
    { borderColor: 'transparent' },
};
const lozLook = {
  width: 'auto',
  minWidth: 0,
  '& .MuiOutlinedInput-root, & .MuiOutlinedInput-root:hover, & .MuiOutlinedInput-root.Mui-focused':
    {
      backgroundColor: 'transparent',
      color: 'inherit',
      fontSize: 11,
      fontWeight: 700,
      textTransform: 'uppercase',
    },
  '& .MuiSelect-select': {
    padding: '0 22px 0 6px !important',
    minHeight: '20px !important',
    lineHeight: '20px',
  },
  '& .MuiSelect-icon': { color: 'inherit', right: 2, fontSize: 18 },
  '& .MuiOutlinedInput-notchedOutline, & .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline':
    { border: 'none' },
};
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  todo: { bg: 'var(--bg-neutral)', fg: 'var(--text)' },
  inprogress: { bg: 'var(--brand)', fg: 'var(--brand-text)' },
  done: { bg: '#1f845a', fg: '#ffffff' },
};
const statusLook = (tone: string, color?: string) => {
  const c = color ? { bg: color, fg: readableOn(color) } : STATUS_TONE[tone] || STATUS_TONE.todo;
  return {
    width: 'auto',
    '& .MuiOutlinedInput-root, & .MuiOutlinedInput-root:hover, & .MuiOutlinedInput-root.Mui-focused':
      {
        backgroundColor: c.bg,
        color: c.fg,
        fontWeight: 600,
        height: 32,
      },
    '& .MuiSelect-icon': { color: c.fg },
    '& .MuiOutlinedInput-notchedOutline, & .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline':
      { border: 'none' },
  };
};
// "&&" doubles the class so these looks win over the theme's default input styles.
const look = (p: Any) =>
  [
    p.ghost && ghost,
    p.title && titleLook,
    p.bare && bare,
    p.mono && mono,
    p.filter && filterLook,
    p.loz && lozLook,
    p.tone && statusLook(p.tone, p.toneColor),
  ]
    .filter(Boolean)
    .map((x) => ({ '&&': x }));
function split(props: Any) {
  const {
    ghost: _g,
    title: _t,
    bare: _b,
    mono: _m,
    filter: _f,
    loz: _l,
    tone: _tn,
    toneColor: _tc,
    search,
    min,
    max,
    maxLength,
    readOnly,
    spellCheck,
    rows,
    maxRows,
    'aria-label': ariaLabel,
    sx,
    autoComplete,
    list: _list,
    ...rest
  } = props;
  return {
    rest,
    search,
    html: { min, max, maxLength, readOnly, spellCheck, 'aria-label': ariaLabel, autoComplete },
    rows,
    maxRows,
    sx,
  };
}
/** Single-line text input (MUI TextField). */
export function TF(props: Any) {
  const { rest, search, html, sx } = split(props);
  return (
    <TextField
      {...rest}
      sx={[...look(props), ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      slotProps={{
        htmlInput: html,
        input: search
          ? {
              startAdornment: (
                <InputAdornment position="start" sx={{ mr: 0, color: 'var(--text-subtlest)' }}>
                  {ico(I.search)}
                </InputAdornment>
              ),
            }
          : undefined,
      }}
    />
  );
}
/** Multi-line text input that grows with its content (MUI TextField multiline). */
export function TA(props: Any) {
  const { rest, html, rows, maxRows, sx } = split(props);
  return (
    <TextField
      {...rest}
      multiline
      minRows={rows || (props.title ? 1 : 2)}
      maxRows={maxRows || 24}
      sx={[...look(props), ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      slotProps={{ htmlInput: html }}
    />
  );
}
/** The text a menu item shows (for searching). */
const textOf = (n: Any): string =>
  typeof n === 'string' || typeof n === 'number'
    ? String(n)
    : Array.isArray(n)
      ? n.map(textOf).join(' ')
      : isValidElement(n)
        ? textOf((n.props as Any).children)
        : '';
const flatItems = (children: ReactNode): Any[] =>
  Children.toArray(children).flatMap((c: Any) =>
    isValidElement(c) && c.type === Fragment ? flatItems((c.props as Any).children) : [c],
  );
/** Dropdowns with at least this many choices get a search box at the top of their menu. */
const SEARCH_MIN = 8;
/**
 * Dropdown (MUI Select). Children are <MenuItem>s; an item with value "" acts as the
 * placeholder/None.
 * With 8 or more choices (or searchable), the open menu starts with a search box: type to narrow
 * the list, ↓ to move into it, Enter to pick the first match. searchable={false} turns it off.
 */
export function SF({ children, placeholder, className, searchable, ...props }: Any) {
  // Select-only options go to the Select, never onto the TextField's root element (React warns
  // about unknown DOM props like displayEmpty). Empty values always show, so displayEmpty is on for
  // every dropdown.
  const {
    displayEmpty: _de,
    renderValue,
    MenuProps,
    multiple,
    open,
    onOpen,
    onClose,
    autoWidth,
    ...own
  } = props;
  const { rest, html, sx } = split(own);
  const [q, setQ] = useState('');
  const items = flatItems(children);
  const choices = items.filter(
    (c) =>
      isValidElement(c) &&
      c.type === MenuItem &&
      (c.props as Any).value !== '' &&
      (c.props as Any).value !== undefined,
  );
  const canSearch = searchable ?? choices.length >= SEARCH_MIN;
  const qq = q.trim().toLowerCase();
  // Items that don't match stay in the list (hidden and skipped), so the chosen value still shows
  // in the field.
  const hide = (c: Any) =>
    cloneElement(c, {
      disabled: true,
      style: { ...((c.props as Any).style || {}), display: 'none' },
    });
  const shown =
    !canSearch || !qq
      ? items
      : items.map((c) => {
          if (!isValidElement(c)) return c;
          if (c.type !== MenuItem) return hide(c); // headings and dividers while searching
          const v = (c.props as Any).value;
          return `${textOf((c.props as Any).children)} ${typeof v === 'string' ? v : ''}`
            .toLowerCase()
            .includes(qq)
            ? c
            : hide(c);
        });
  const matches = qq
    ? shown.filter((c) => isValidElement(c) && c.type === MenuItem && !(c.props as Any).disabled)
        .length
    : choices.length;
  const firstOption = (el: HTMLElement) =>
    [
      ...(el.closest('ul')?.querySelectorAll<HTMLElement>('li[role="option"][tabindex]') || []),
    ].find((li) => li.style.display !== 'none' && li.getAttribute('aria-disabled') !== 'true');
  const search = canSearch ? (
    <ListSubheader key="__sf_search" className="sf-search">
      <div
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        <span className="sf-search-ic">{ico(I.search)}</span>
        <input
          autoFocus
          placeholder="Search"
          aria-label="Search the options"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Tab') return; // the menu closes as usual
            e.stopPropagation(); // typing must not jump to items (the menu's type-ahead)
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              firstOption(e.currentTarget)?.focus();
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              firstOption(e.currentTarget)?.click();
            }
          }}
        />
        {qq && <span className="sf-count">{matches || 'No matches'}</span>}
      </div>
    </ListSubheader>
  ) : null;
  return (
    <TextField
      select
      {...rest}
      className={className}
      sx={[...look(props), ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      slotProps={{
        htmlInput: html,
        select: {
          displayEmpty: true,
          MenuProps: {
            ...(MenuProps || {}),
            ...(canSearch && { autoFocus: false }),
            slotProps: { paper: { sx: { maxHeight: 360 } }, ...(MenuProps?.slotProps || {}) },
          },
          renderValue:
            renderValue ||
            (placeholder
              ? (v: Any) =>
                  v === '' || v == null ? (
                    <span style={{ color: props.filter ? 'inherit' : 'var(--text-subtlest)' }}>
                      {placeholder}
                    </span>
                  ) : undefined
              : undefined),
          ...(multiple !== undefined && { multiple }),
          ...(open !== undefined && { open }),
          ...(autoWidth !== undefined && { autoWidth }),
          onOpen: (e: Any) => {
            setQ('');
            onOpen?.(e);
          },
          onClose: (e: Any) => {
            onClose?.(e);
            setTimeout(() => setQ(''), 200);
          },
        },
      }}
    >
      {search}
      {shown}
    </TextField>
  );
}
/** Plain string options as MenuItems. */
export const opts = (list: string[]) =>
  list.map((x) => (
    <MenuItem key={x} value={x}>
      {x}
    </MenuItem>
  ));
/** Checkbox (MUI). Pass `label` to render it with a label. */
export function CB({ label, className: _c, ...props }: Any) {
  const box = (
    <Checkbox {...props} slotProps={{ input: { 'aria-label': props['aria-label'] } as Any }} />
  );
  return label ? <FormControlLabel control={box} label={label} /> : box;
}
/** Radio button with label (MUI). */
export const RB = ({ label, ...props }: Any) => (
  <FormControlLabel control={<Radio {...props} />} label={label} />
);
