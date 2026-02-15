import React, { useState, useRef, useEffect, useCallback } from 'react';
import './SearchableDropdown.css';

/**
 * Reusable searchable dropdown for the toolbar.
 *
 * Props:
 *   value       — current selected value
 *   onChange     — callback(newValue)
 *   options      — [{ value, label, description? }]
 *   label?       — short label shown on the button
 *   placeholder? — placeholder for the search input
 *   darkMode?    — boolean
 */
const SearchableDropdown = ({
  value,
  onChange,
  options = [],
  label = '',
  placeholder = 'Search…',
  darkMode = false,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus input when opening
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const toggle = useCallback(() => {
    setOpen((o) => {
      if (o) setSearch('');
      return !o;
    });
  }, []);

  const handleSelect = useCallback(
    (val) => {
      onChange(val);
      setOpen(false);
      setSearch('');
    },
    [onChange],
  );

  const selected = options.find((o) => o.value === value);
  const lowerSearch = search.toLowerCase();
  const filtered = search
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(lowerSearch) ||
          (o.description && o.description.toLowerCase().includes(lowerSearch)),
      )
    : options;

  return (
    <div
      className={`sdd-root${darkMode ? ' sdd-dark' : ''}${open ? ' sdd-open' : ''}`}
      ref={ref}
    >
      <button className="sdd-trigger" onClick={toggle} title={label}>
        {label ? <span className="sdd-label">{label}:</span> : null}
        <span className="sdd-value">{selected?.label ?? 'Select…'}</span>
        <span className="sdd-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="sdd-menu">
          {options.length > 4 && (
            <div className="sdd-search-row">
              <input
                ref={inputRef}
                className="sdd-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={placeholder}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <div className="sdd-items">
            {filtered.length === 0 && (
              <div className="sdd-empty">No matches</div>
            )}
            {filtered.map((o) => (
              <div
                key={o.value}
                className={`sdd-item${o.value === value ? ' sdd-selected' : ''}`}
                onClick={() => handleSelect(o.value)}
              >
                <span className="sdd-item-label">{o.label}</span>
                {o.description && (
                  <span className="sdd-item-desc">{o.description}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableDropdown;
