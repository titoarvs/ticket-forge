'use client';
// MUI-based form inputs used across the app. Props mirror native inputs (onChange/onBlur receive events)
// so they drop in where <input>, <textarea> and <select> were used.
import type { ReactNode } from 'react';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import Radio from '@mui/material/Radio';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import Autocomplete from '@mui/material/Autocomplete';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import { I, typeIcon } from './icons';
import { hashColor, initials, type Any } from './core';

export { MenuItem };

const ico = (svg: string) => <span className="ico" dangerouslySetInnerHTML={{ __html: svg }} />;

// Looks: "ghost" = borderless until hover/focus (Jira inline edit), "title" = large ghost heading,
// "bare" = no chrome (inside inline forms), "filter" = compact toolbar dropdown, "loz" = status pill.
const ghost = {
  '& .MuiOutlinedInput-root': { backgroundColor: 'transparent' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
  '& .MuiOutlinedInput-root:hover': { backgroundColor: 'var(--hover)' },
  '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
  '& .MuiOutlinedInput-root.Mui-focused': { backgroundColor: 'var(--bg)' },
  '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border-focus)' },
  '& .MuiOutlinedInput-root.Mui-disabled': { backgroundColor: 'transparent' },
  '& .MuiOutlinedInput-root.Mui-disabled .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
  '& .MuiInputBase-input.Mui-disabled': { WebkitTextFillColor: 'var(--text)', color: 'var(--text)' },
};
const titleLook = { ...ghost, '& .MuiInputBase-root': { fontSize: 24, lineHeight: '28px', fontWeight: 500, ml: '-6px' } };
const bare = {
  '& .MuiOutlinedInput-root, & .MuiOutlinedInput-root:hover, & .MuiOutlinedInput-root.Mui-focused': { backgroundColor: 'transparent' },
  '& .MuiOutlinedInput-notchedOutline, & .Mui-focused .MuiOutlinedInput-notchedOutline': { border: 'none' },
};
const mono = { '& .MuiInputBase-input': { fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre', tabSize: 2 } };
const filterLook = {
  width: 'auto', maxWidth: 200, minWidth: 0,
  '& .MuiOutlinedInput-root': { backgroundColor: 'var(--bg-neutral)', fontWeight: 500, color: 'var(--text-subtle)' },
  '& .MuiOutlinedInput-root:hover': { backgroundColor: 'var(--bg-neutral-2)' },
  '& .MuiOutlinedInput-notchedOutline, & .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
};
const lozLook = {
  width: 'auto', minWidth: 0,
  '& .MuiOutlinedInput-root, & .MuiOutlinedInput-root:hover, & .MuiOutlinedInput-root.Mui-focused': { backgroundColor: 'transparent', color: 'inherit', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' },
  '& .MuiSelect-select': { padding: '0 22px 0 6px !important', minHeight: '20px !important', lineHeight: '20px' },
  '& .MuiSelect-icon': { color: 'inherit', right: 2, fontSize: 18 },
  '& .MuiOutlinedInput-notchedOutline, & .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { border: 'none' },
};
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  todo: { bg: 'var(--bg-neutral)', fg: 'var(--text)' },
  inprogress: { bg: 'var(--brand)', fg: 'var(--brand-text)' },
  done: { bg: '#1f845a', fg: '#ffffff' },
};
const statusLook = (tone: string) => {
  const c = STATUS_TONE[tone] || STATUS_TONE.todo;
  return {
    width: 'auto',
    '& .MuiOutlinedInput-root, & .MuiOutlinedInput-root:hover, & .MuiOutlinedInput-root.Mui-focused': { backgroundColor: c.bg, color: c.fg, fontWeight: 600, height: 32 },
    '& .MuiSelect-icon': { color: c.fg },
    '& .MuiOutlinedInput-notchedOutline, & .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { border: 'none' },
  };
};
// "&&" doubles the class so these looks win over the theme's default input styles.
const look = (p: Any) => [
  p.ghost && ghost, p.title && titleLook, p.bare && bare, p.mono && mono, p.filter && filterLook, p.loz && lozLook, p.tone && statusLook(p.tone),
].filter(Boolean).map((x) => ({ '&&': x }));

function split(props: Any) {
  const { ghost: _g, title: _t, bare: _b, mono: _m, filter: _f, loz: _l, tone: _tn, search, min, max, maxLength, readOnly, spellCheck, rows, maxRows,
    'aria-label': ariaLabel, sx, autoComplete, list: _list, ...rest } = props;
  return { rest, search, html: { min, max, maxLength, readOnly, spellCheck, 'aria-label': ariaLabel, autoComplete }, rows, maxRows, sx };
}

/** Single-line text input (MUI TextField). */
export function TF(props: Any) {
  const { rest, search, html, sx } = split(props);
  return (
    <TextField {...rest} sx={[...look(props), ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      slotProps={{
        htmlInput: html,
        input: search ? { startAdornment: <InputAdornment position="start" sx={{ mr: 0, color: 'var(--text-subtlest)' }}>{ico(I.search)}</InputAdornment> } : undefined,
      }} />
  );
}

/** Multi-line text input that grows with its content (MUI TextField multiline). */
export function TA(props: Any) {
  const { rest, html, rows, maxRows, sx } = split(props);
  return (
    <TextField {...rest} multiline minRows={rows || (props.title ? 1 : 2)} maxRows={maxRows || 24}
      sx={[...look(props), ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]} slotProps={{ htmlInput: html }} />
  );
}

/** Dropdown (MUI Select). Children are <MenuItem>s; an item with value "" acts as the placeholder/None. */
export function SF({ children, placeholder, className, ...props }: Any) {
  // Select-only options go to the Select, never onto the TextField's root element (React warns about unknown
  // DOM props like displayEmpty). Empty values always show, so displayEmpty is on for every dropdown.
  const { displayEmpty: _de, renderValue, MenuProps, multiple, open, onOpen, onClose, autoWidth, ...own } = props;
  const { rest, html, sx } = split(own);
  return (
    <TextField select {...rest} className={className} sx={[...look(props), ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
      slotProps={{
        htmlInput: html,
        select: {
          displayEmpty: true,
          MenuProps: { ...(MenuProps || {}), slotProps: { paper: { sx: { maxHeight: 360 } }, ...(MenuProps?.slotProps || {}) } },
          renderValue: renderValue || (placeholder ? (v: Any) => (v === '' || v == null ? <span style={{ color: props.filter ? 'inherit' : 'var(--text-subtlest)' }}>{placeholder}</span> : undefined) : undefined),
          ...(multiple !== undefined && { multiple }), ...(open !== undefined && { open }), ...(onOpen && { onOpen }), ...(onClose && { onClose }), ...(autoWidth !== undefined && { autoWidth }),
        },
      }}>
      {children}
    </TextField>
  );
}
/** Plain string options as MenuItems. */
export const opts = (list: string[]) => list.map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>);

/** Checkbox (MUI). Pass `label` to render it with a label. */
export function CB({ label, className: _c, ...props }: Any) {
  const box = <Checkbox {...props} slotProps={{ input: { 'aria-label': props['aria-label'] } as Any }} />;
  return label ? <FormControlLabel control={box} label={label} /> : box;
}
/** Radio button with label (MUI). */
export const RB = ({ label, ...props }: Any) => <FormControlLabel control={<Radio {...props} />} label={label} />;

/** Date input (MUI X DatePicker) working with "YYYY-MM-DD" strings. */
export function DateF({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <DatePicker value={value ? dayjs(value) : null} disabled={disabled} format="D MMM YYYY"
      onChange={(d: Any) => onChange(d && d.isValid() ? d.format('YYYY-MM-DD') : '')}
      slotProps={{ textField: { size: 'small', fullWidth: true } as Any }} />
  );
}

/** Free-text people picker with suggestions (MUI Autocomplete). onChange receives the name. */
export function PeopleF({ value, onChange, onCommit, options, placeholder, disabled, autoFocus, ghost: isGhost = false, avatars = true }: {
  value: string; onChange: (v: string) => void; onCommit?: (v: string) => void; options: string[]; placeholder?: string; disabled?: boolean; autoFocus?: boolean; ghost?: boolean; avatars?: boolean;
}) {
  return (
    <Autocomplete freeSolo fullWidth disableClearable={false} sx={{ flex: 1, minWidth: 0 }} options={options} value={value || ''} inputValue={value || ''} disabled={disabled}
      onInputChange={(_e, v, reason) => { if (reason !== 'reset' || v) onChange(v); }}
      onChange={(_e, v: Any) => { onChange(v || ''); onCommit?.(v || ''); }}
      onBlur={() => onCommit?.(value)}
      renderOption={(props: Any, option: string) => {
        const { key, ...p } = props;
        if (!avatars) return <li key={key} {...p}>{option}</li>;
        return <li key={key} {...p}><span className="avatar" style={{ background: hashColor(option), width: 20, height: 20, fontSize: 9 }}>{initials(option)}</span>{option}</li>;
      }}
      renderInput={(params) => <TextField {...params} placeholder={placeholder} autoFocus={autoFocus} sx={isGhost ? { '&&': ghost } : undefined} />} />
  );
}

/** Small icon + label used inside MenuItems for issue types. */
export const TypeLabel = ({ type, children }: { type: string; children?: ReactNode }) => <>{ico(typeIcon(type))}{children ?? type}</>;
