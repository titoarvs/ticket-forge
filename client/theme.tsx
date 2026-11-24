'use client';
// MUI theme matched to the design tokens in globals.css. Light is the default; people can switch to
// dark (stored per browser). The mode is the data-theme attribute on <html>, which globals.css
// also keys off.
import type { ReactNode } from 'react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { ThemeProvider, createTheme, useColorScheme } from '@mui/material/styles';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';

const FONT =
  'var(--font-ui), "Onest", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif';

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data-theme' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#161616', dark: '#303030', contrastText: '#ffffff' },
        error: { main: '#c4281c' },
        success: { main: '#3a6b00' },
        background: { default: '#ffffff', paper: '#ffffff' },
        text: { primary: '#131313', secondary: '#6b6b6b', disabled: '#a0a0a0' },
        divider: '#ebebeb',
      },
    },
    dark: {
      palette: {
        primary: { main: '#f2f2f2', dark: '#d9d9d9', contrastText: '#141414' },
        error: { main: '#ff8d80' },
        success: { main: '#a5d84d' },
        background: { default: '#111112', paper: '#1a1a1c' },
        text: { primary: '#f4f4f4', secondary: '#949497', disabled: '#626265' },
        divider: '#29292b',
      },
    },
  },
  shape: { borderRadius: 8 },
  typography: { fontFamily: FONT, fontSize: 14, button: { textTransform: 'none' } },
  components: {
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true, variant: 'outlined' } },
    MuiInputBase: {
      styleOverrides: {
        root: { fontSize: 14, lineHeight: '20px', color: 'var(--text)' },
        input: { '&::placeholder': { color: 'var(--text-subtlest)', opacity: 1 } },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: 'var(--bg)',
          borderRadius: 8,
          transition: 'background-color .12s, box-shadow .12s',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'var(--border-input)',
            transition: 'border-color .12s',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'color-mix(in srgb, var(--border-input) 55%, var(--text-disabled))',
          },
          '&.Mui-focused': {
            backgroundColor: 'var(--bg)',
            boxShadow: '0 0 0 3px color-mix(in srgb, var(--border-focus) 12%, transparent)',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: 'var(--border-focus)',
            borderWidth: 1,
          },
          '&.Mui-disabled': { backgroundColor: 'var(--bg-sunken)' },
          '&.Mui-disabled .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border)' },
        },
        input: { padding: '8px 10px', height: 20 },
        multiline: { padding: '8px 10px' },
      },
    },
    MuiSelect: {
      defaultProps: { size: 'small' },
      styleOverrides: { select: { minHeight: 20, display: 'flex', alignItems: 'center', gap: 6 } },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiPopover: {
      styleOverrides: {
        paper: {
          backgroundColor: 'var(--overlay)',
          boxShadow: 'var(--shadow-overlay)',
          border: '1px solid var(--border)',
          borderRadius: 12,
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        paper: {
          backgroundColor: 'var(--overlay)',
          boxShadow: 'var(--shadow-overlay)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          fontSize: 14,
        },
        inputRoot: { padding: '4px 10px !important' },
        input: { padding: '4px 0 !important' },
        listbox: { padding: 6 },
        option: { gap: 8, minHeight: 34, borderRadius: 7 },
      },
    },
    MuiList: { styleOverrides: { padding: { paddingTop: 6, paddingBottom: 6 } } },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: 14,
          minHeight: 34,
          gap: 8,
          margin: '0 6px',
          padding: '6px 10px',
          borderRadius: 7,
          '&:hover': { backgroundColor: 'var(--hover)' },
          '&.Mui-selected, &.Mui-selected:hover': {
            backgroundColor: 'var(--selected-bg)',
            color: 'var(--selected-text)',
          },
        },
      },
    },
    MuiCheckbox: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { padding: 4, color: 'var(--border-strong)' } },
    },
    MuiRadio: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { padding: 4, color: 'var(--border-strong)' } },
    },
    MuiFormControlLabel: {
      styleOverrides: { root: { marginLeft: -4, marginRight: 0, gap: 4 }, label: { fontSize: 14 } },
    },
  },
});

const MODE_KEY = 'tf-theme';

/** Switches between the light (default) and dark themes. */
export function useThemeMode() {
  const { mode, systemMode, setMode } = useColorScheme();
  const current = (mode === 'system' ? systemMode : mode) || 'light';
  return { mode: current, toggle: () => setMode(current === 'dark' ? 'light' : 'dark') };
}

export default function ThemeRegistry({ children }: { children: ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ key: 'mui' }}>
      <ThemeProvider
        theme={theme}
        defaultMode="light"
        modeStorageKey={MODE_KEY}
        disableTransitionOnChange
      >
        <LocalizationProvider dateAdapter={AdapterDayjs}>{children}</LocalizationProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
