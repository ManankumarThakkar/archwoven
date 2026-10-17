'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  questions: string[];
  busy: boolean;
  onContinue: (answers: string[] | null) => void;
  onEdit: () => void;
}

export function ClarificationPanel({ questions, busy, onContinue, onEdit }: Props) {
  const [answers, setAnswers] = useState(() => questions.map(() => ''));
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  return <section className="aw-clarification" aria-labelledby="clarification-title" aria-busy={busy}>
    <span className="aw-eyebrow">A LITTLE MORE CONTEXT</span>
    <h2 id="clarification-title">Let’s clear up a few details.</h2>
    <p id="clarification-help">Answer what you know, or skip for now. Unanswered questions stay visible as gaps in your diagram. Your original description is kept.</p>
    <form onSubmit={e => { e.preventDefault(); if (!busy && answers.some(a => a.trim())) onContinue(answers); }}>
      <fieldset disabled={busy}>
        {questions.map((question, i) => <div className="aw-clarification-field" key={question}>
          <label htmlFor={`clarification-answer-${i}`}>{i + 1}. {question}</label>
          <textarea ref={i === 0 ? first : undefined} id={`clarification-answer-${i}`} rows={2} maxLength={1000} aria-describedby="clarification-help" value={answers[i]} onChange={e => setAnswers(a => a.map((v, j) => j === i ? e.target.value : v))} />
        </div>)}
        <div className="aw-clarification-actions">
          <button className="aw-primary" type="submit" disabled={!answers.some(a => a.trim())}>Continue with answers</button>
          <button type="button" onClick={() => onContinue(null)}>Skip for now</button>
          <button type="button" onClick={onEdit}>Edit description</button>
        </div>
      </fieldset>
    </form>
  </section>;
}
