'use client';
// The issue panel in the drawer. It only lays out the sections in client/Drawer/issue/.
import { type Any, can, isSub, ticket, epic } from '../core';
import { TestsSection } from '../TestRepo';
import { TA } from '../fields';
import { ReferencesSection } from '../References';
import { useAutoTour } from '../tour';
import { setIssueField } from './issue/edit';
import { IssueHead } from './issue/head';
import { IssueToolbar } from './issue/toolbar';
import { DescriptionSection, UserStorySection, DependencyNotes } from './issue/text-sections';
import { AcceptanceCriteria } from './issue/acceptance';
import { ChildIssues } from './issue/child-issues';
import { LinkedIssues } from './issue/linked-issues';
import { TestCasesSection } from './issue/test-cases';
import { DevelopmentSection } from './issue/development';
import { ActivitySection } from './issue/activity';
import { IssueDetails } from './issue/details';

export function IssuePanel({ t }: { t: Any }) {
  useAutoTour('drawer');
  const edit = can('issue.edit');
  const parent = isSub(t) ? ticket(t.parentId) : null;
  const e = epic((parent || t).epicId);
  return (
    <>
      <IssueHead t={t} e={e} parent={parent} edit={edit} />
      <div className="dr-scroll">
        <TA
          title
          rows={1}
          aria-label="Summary"
          disabled={!edit}
          value={t.title}
          onChange={(ev) => setIssueField(t, 'title', ev.target.value.replace(/\n/g, ' '))}
        />
        <IssueToolbar t={t} edit={edit} />
        <div className="dr-cols">
          <div className="dr-main">
            <DescriptionSection t={t} edit={edit} />
            <UserStorySection t={t} edit={edit} />
            <AcceptanceCriteria t={t} edit={edit} />
            <ReferencesSection t={t} />
            {!isSub(t) && <ChildIssues t={t} />}
            <LinkedIssues t={t} edit={edit} />
            <TestCasesSection t={t} edit={edit} />
            <TestsSection t={t} />
            <DevelopmentSection t={t} edit={edit} />
            <DependencyNotes t={t} edit={edit} />
            <ActivitySection t={t} />
          </div>
          <IssueDetails t={t} edit={edit} e={e} />
        </div>
      </div>
    </>
  );
}
