"use client";
// Options JSON of a channel or pin manager with completion, hover and checks
// from the schema the vehicle reports (see options-language.ts).
import React, { useEffect, useRef } from "react";
import { forceLinting } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { optionsExtensions, type ChannelTypeSchema } from "./options-language";

export interface OptionsJsonFieldProps {
  value: string;
  onChange(text: string): void;
  schema?: ChannelTypeSchema;
  /** Configured pin manager names, offered for options that name one. */
  pinManagers?: string[];
}

export default function OptionsJsonField(props: OptionsJsonFieldProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: optionsExtensions({
          context: () => ({ schema: latest.current.schema, pinManagers: latest.current.pinManagers ?? [] }),
          onChange: (text) => latest.current.onChange(text),
        }),
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== props.value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value } });
  }, [props.value]);

  // A different type (or the schema arriving later) changes what is valid.
  useEffect(() => {
    if (view.current) forceLinting(view.current);
  }, [props.schema, props.pinManagers]);

  return <div ref={host} className="w-full min-w-0 rounded border border-zinc-700 focus-within:border-zinc-500 overflow-hidden" data-options-json />;
}
