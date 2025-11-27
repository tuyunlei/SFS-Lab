
import React, { useState, useEffect } from 'react';

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

export const NumberInput: React.FC<NumberInputProps> = ({ unit, className, value, onChange, ...props }) => {
  // 本地状态：允许保留用户的原始输入字符串（例如 "", "0.", "05" 等）
  // 避免父组件 Number() 转换后回传导致输入框内容跳变
  const [localValue, setLocalValue] = useState<string>(value !== undefined ? String(value) : '');

  useEffect(() => {
    // 只有当父组件传入的值与当前本地值的数值含义不一致时，才同步。
    // 例如：父组件传回 0，但本地是 "" (Number("") === 0)，此时不应该同步为 "0"，
    // 否则用户刚删除完内容，输入框立刻就变成了 0。
    setLocalValue(prev => {
      const currentNum = prev === '' ? 0 : Number(prev);
      if (value !== undefined && Number(value) !== currentNum) {
        return String(value);
      }
      return prev;
    });
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    if (onChange) {
      onChange(e);
    }
  };

  return (
    <div className="relative">
      <input
        type="number"
        className={`w-full bg-space-800 border border-space-600 rounded-md px-3 py-2 text-sm text-space-100 focus:outline-none focus:ring-2 focus:ring-space-accent focus:border-transparent transition-all ${className}`}
        value={localValue}
        onChange={handleChange}
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
        className="w-full bg-space-800 border border-space-600 rounded-md pl-3 pr-10 py-2 text-sm text-space-100 focus:outline-none focus:ring-2 focus:ring-space-accent focus:border-transparent appearance-none truncate"
        style={{ 
          appearance: 'none', 
          WebkitAppearance: 'none', 
          MozAppearance: 'none' 
        }}
        {...props}
      >
        {props.children}
      </select>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center bg-space-800 pl-1">
        <svg className="w-4 h-4 text-space-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
      </div>
    </div>
  );
};
