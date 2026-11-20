'use client';
import type { ReactNode } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import { typeIcon } from '../icons';
import { type Any, hashColor, initials } from '../core';
import { ghost, ico } from './SF';

/** Date input (MUI X DatePicker) working with "YYYY-MM-DD" strings. */
export function DateF({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <DatePicker
      value={value ? dayjs(value) : null}
      disabled={disabled}
      format="D MMM YYYY"
      onChange={(d: Any) => onChange(d && d.isValid() ? d.format('YYYY-MM-DD') : '')}
      slotProps={{ textField: { size: 'small', fullWidth: true } as Any }}
    />
  );
}
/** Free-text people picker with suggestions (MUI Autocomplete). onChange receives the name. */
export function PeopleF({
  value,
  onChange,
  onCommit,
  options,
  placeholder,
  disabled,
  autoFocus,
  ghost: isGhost = false,
  avatars = true,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  ghost?: boolean;
  avatars?: boolean;
}) {
  return (
    <Autocomplete
      freeSolo
      fullWidth
      disableClearable={false}
      sx={{ flex: 1, minWidth: 0 }}
      options={options}
      value={value || ''}
      inputValue={value || ''}
      disabled={disabled}
      onInputChange={(_e, v, reason) => {
        if (reason !== 'reset' || v) onChange(v);
      }}
      onChange={(_e, v: Any) => {
        onChange(v || '');
        onCommit?.(v || '');
      }}
      onBlur={() => onCommit?.(value)}
      renderOption={(props: Any, option: string) => {
        const { key, ...p } = props;
        if (!avatars)
          return (
            <li key={key} {...p}>
              {option}
            </li>
          );
        return (
          <li key={key} {...p}>
            <span
              className="avatar"
              style={{ background: hashColor(option), width: 20, height: 20, fontSize: 9 }}
            >
              {initials(option)}
            </span>
            {option}
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={placeholder}
          autoFocus={autoFocus}
          sx={isGhost ? { '&&': ghost } : undefined}
        />
      )}
    />
  );
}
/** Small icon + label used inside MenuItems for issue types. */
export const TypeLabel = ({ type, children }: { type: string; children?: ReactNode }) => (
  <>
    {ico(typeIcon(type))}
    {children ?? type}
  </>
);
