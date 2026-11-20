'use client';
// The issue's free-text sections: description, user story and dependency notes.
import { mutate, setField } from '../../core';
import { RichTextField } from '../../CommentEditor';
import { TA } from '../../fields';
import { type IssueProps, setIssueField } from './edit';

export function DescriptionSection({ t, edit }: IssueProps) {
  return (
    <div className="sec">
      <div className="sec-title">
        <h3>Description</h3>
      </div>
      <RichTextField
        key={t.id}
        ghost
        disabled={!edit}
        text={t.description}
        rich={t.descriptionRich}
        placeholder="Add a description…"
        onChange={(v) =>
          mutate(
            () => {
              setField(t, 'description', v.text);
              t.descriptionRich = v;
            },
            { tag: `t.description${t.id}` },
          )
        }
      />
    </div>
  );
}

export function UserStorySection({ t, edit }: IssueProps) {
  return (
    <div className="sec">
      <div className="sec-title">
        <h3>User story</h3>
      </div>
      <TA
        ghost
        disabled={!edit}
        value={t.userStory}
        placeholder="As a …, I want …, so that …"
        onChange={(ev) => setIssueField(t, 'userStory', ev.target.value)}
      />
    </div>
  );
}

/** One note per line; saved when the field loses focus. */
export function DependencyNotes({ t, edit }: IssueProps) {
  const save = (text: string) =>
    setIssueField(
      t,
      'dependencies',
      text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  return (
    <div className="sec">
      <div className="sec-title">
        <h3>Dependency notes</h3>
      </div>
      <TA
        ghost
        disabled={!edit}
        placeholder="One per line"
        key={t.dependencies.join('|')}
        defaultValue={t.dependencies.join('\n')}
        onBlur={(ev) => save(ev.target.value)}
      />
    </div>
  );
}
