import React from 'react';

interface InputGroupProps {
  label: string;
  subLabel?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}

export const InputGroup: React.FC<InputGroupProps> = ({ label, subLabel, error, children, className = "" }) => {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex justify-between items-baseline">
        <label className="text-sm font-medium text-space-500">{label}</label>
        {subLabel && <span className="text-xs text-space-600">{subLabel}</span>}
      </div>
      {children}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
};

interface NumberInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  unit?: string;
}

export const NumberInput: React.FC<NumberInputProps> = ({ unit, className, ...props }) => {
  return (
    <div className="relative">
      <input
        type="number"
        className={`w-full bg-space-800 border border-space-600 rounded-md px-3 py-2 text-sm text-space-100 focus:outline-none focus:ring-2 focus:ring-space-accent focus:border-transparent transition-all ${className}`}
        {...props}
      />
      {unit && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-space-500 pointer-events-none">
          {unit}
        </span>
      )}
    </div>
  );
};

export const Slider: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => {
  return (
    <input
      type="range"
      className="w-full h-2 bg-space-800 rounded-lg appearance-none cursor-pointer accent-space-accent hover:accent-space-400"
      {...props}
    />
  );
};

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => {
  return (
    <div className="relative">
      <select
        className="w-full bg-space-800 border border-space-600 rounded-md px-3 py-2 text-sm text-space-100 focus:outline-none focus:ring-2 focus:ring-space-accent focus:border-transparent appearance-none"
        {...props}
      >
        {props.children}
      </select>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
        <svg className="w-4 h-4 text-space-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
      </div>
    </div>
  );
};