'use client';
// MUI theme matched to the Jira-style design tokens in globals.css (light and dark follow the system setting).
import type { ReactNode } from 'react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif';

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'media' },
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
        primary: { main: '#579dff', dark: '#85b8ff', contrastText: '#1d2125' },
        error: { main: '#f87168' },
        success: { main: '#7ee2b8' },
        background: { default: '#1d2125', paper: '#282e33' },
        text: { primary: '#b6c2cf', secondary: '#8c9bab', disabled: '#596773' },
        divider: 'rgba(166, 197, 226, 0.16)',
      },
    },
  },
  shape: { borderRadius: 3 },
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
    MuiPopover: { styleOverrides: { paper: { backgroundColor: 'var(--overlay)', boxShadow: 'var(--shadow-overlay)', borderRadius: 3 } } },
    MuiAutocomplete: {
      styleOverrides: {
        paper: { backgroundColor: 'var(--overlay)', boxShadow: 'var(--shadow-overlay)', borderRadius: 3, fontSize: 14 },
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

export default function ThemeRegistry({ children }: { children: ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ key: 'mui' }}>
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>{children}</LocalizationProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
