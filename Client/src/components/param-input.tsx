import React from "react";
import { flowNodeStyles } from "./flow-node-styles";

// Component for individual parameter input with local state
// This prevents focus loss during typing by using local state
// and only updating the global state onBlur
export function ParamInput({ 
  name, 
  value, 
  onBlur,
  className = `${flowNodeStyles.input} w-20 text-right font-mono`,
  placeholder
}: { 
  name: string; 
  value: string | number; 
  onBlur: (key: string, value: any) => void;
  className?: string;
  placeholder?: string;
}) {
  const [localValue, setLocalValue] = React.useState(value);
  
  // Update local value when prop changes (e.g., from other sources)
  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);
  
  const handleBlur = () => {
    // Only update if value changed and not empty
    if (localValue !== value && localValue !== '') {
      onBlur(name, localValue);
    } else if (localValue === '' && value !== '') {
      // If user cleared the field, reset to original value
      setLocalValue(value);
    }
  };
  
  return (
    <div className="flex flex-row items-center justify-between gap-2">
      <span className="text-zinc-300 text-xs text-left flex-1">{name}</span>
      <input
        className={className}
        value={localValue}
        onChange={e => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
          e.stopPropagation();
        }}
        placeholder={placeholder}
      />
    </div>
  );
}

// Simple version without the wrapper div, for custom layouts
export function ParamInputField({ 
  name, 
  value, 
  onBlur,
  className = flowNodeStyles.input,
  placeholder
}: { 
  name: string; 
  value: string | number; 
  onBlur: (key: string, value: any) => void;
  className?: string;
  placeholder?: string;
}) {
  const [localValue, setLocalValue] = React.useState(value);
  
  // Update local value when prop changes (e.g., from other sources)
  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);
  
  const handleBlur = () => {
    // Only update if value changed and not empty
    if (localValue !== value && localValue !== '') {
      onBlur(name, localValue);
    } else if (localValue === '' && value !== '') {
      // If user cleared the field, reset to original value
      setLocalValue(value);
    }
  };
  
  return (
    <input
      className={className}
      value={localValue}
      onChange={e => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
      placeholder={placeholder}
    />
  );
}

