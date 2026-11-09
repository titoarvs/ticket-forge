'use client';
// MUI theme matched to the design tokens in globals.css. Dark is the default; people can switch to light
// (stored per browser). The mode is the data-theme attribute on <html>, which globals.css also keys off.
import type { ReactNode } from 'react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { ThemeProvider, createTheme, useColorScheme } from '@mui/material/styles';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';

const FONT = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif';

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data-theme' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#0c66e4', dark: '#0055cc', contrastText: '#ffffff' },
        error: { main: '#c9372c' },
        success: { main: '#1f845a' },
        background: { default: '#ffffff', paper: '#ffffff' },
        text: { primary: '#172b4d', secondary: '#626f86', disabled: '#8590a2' },
        divider: '#dcdfe4',
      },
    },
    dark: {
      palette: {
        primary: { main: '#3b82f6', dark: '#2563eb', contrastText: '#ffffff' },
        error: { main: '#f0857a' },
        success: { main: '#4ade80' },
        background: { default: '#0e1013', paper: '#1a1d23' },
        text: { primary: '#f5f7fa', secondary: '#9aa3b2', disabled: '#5a616d' },
        divider: '#252930',
      },
    },
  },
  shape: { borderRadius: 6 },
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
          transition: 'background-color .1s',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border-input)' },
          '&:hover': { backgroundColor: 'var(--bg-sunken)' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border-input)' },
          '&.Mui-focused': { backgroundColor: 'var(--bg)' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border-focus)', borderWidth: 2 },
          '&.Mui-disabled': { backgroundColor: 'var(--bg-sunken)' },
          '&.Mui-disabled .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border)' },
        },
        input: { padding: '6px 8px', height: 20 },
        multiline: { padding: '6px 8px' },
      },
    },
    MuiSelect: {
      defaultProps: { size: 'small' },
      styleOverrides: { select: { minHeight: 20, display: 'flex', alignItems: 'center', gap: 6 } },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiPopover: { styleOverrides: { paper: { backgroundColor: 'var(--overlay)', boxShadow: 'var(--shadow-overlay)', border: '1px solid var(--border)', borderRadius: 8 } } },
    MuiAutocomplete: {
      styleOverrides: {
        paper: { backgroundColor: 'var(--overlay)', boxShadow: 'var(--shadow-overlay)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14 },
        inputRoot: { padding: '2px 8px !important' },
        input: { padding: '4px 0 !important' },
        option: { gap: 8, minHeight: 32 },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: 14, minHeight: 32, gap: 8, borderLeft: '2px solid transparent',
          '&:hover': { backgroundColor: 'var(--hover)', borderLeftColor: 'var(--selected-text)' },
          '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: 'var(--selected-bg)', color: 'var(--selected-text)' },
        },
      },
    },
    MuiCheckbox: { defaultProps: { size: 'small' }, styleOverrides: { root: { padding: 4, color: 'var(--border-input)' } } },
    MuiRadio: { defaultProps: { size: 'small' }, styleOverrides: { root: { padding: 4, color: 'var(--border-input)' } } },
    MuiFormControlLabel: { styleOverrides: { root: { marginLeft: -4, marginRight: 0, gap: 4 }, label: { fontSize: 14 } } },
  },
});

export const MODE_KEY = 'tf-theme';

/** Switches between the dark (default) and light themes. */
export function useThemeMode() {
  const { mode, systemMode, setMode } = useColorScheme();
  const current = (mode === 'system' ? systemMode : mode) || 'dark';
  return { mode: current, toggle: () => setMode(current === 'dark' ? 'light' : 'dark') };
}

export default function ThemeRegistry({ children }: { children: ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ key: 'mui' }}>
      <ThemeProvider theme={theme} defaultMode="dark" modeStorageKey={MODE_KEY} disableTransitionOnChange>
        <LocalizationProvider dateAdapter={AdapterDayjs}>{children}</LocalizationProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
