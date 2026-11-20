'use client';
import { P } from '../core';
import { CodeJobsPage } from './CodeJobsPage';

/** Development → Code jobs inside a project. */
export function ProjectCodeJobs() {
  return <CodeJobsPage projectId={P().id} />;
}
