// API client for reading projects (/api/projects).
import { api, type Any } from '../core';

export const listProjects = (): Promise<Any> => api('/api/projects');
export const getProject = (id: string): Promise<Any> => api(`/api/projects/${id}`);
