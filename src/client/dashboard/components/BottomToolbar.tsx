import React from 'react';

type View = 'report' | 'config' | 'schedule' | 'about';

interface BottomToolbarProps {
    activeView: View;
    onViewChange: (view: View) => void;
}

function BottomToolbar({ activeView, onViewChange }: BottomToolbarProps) {
    const buttons: { view: View; align: string; label: string; icon: string }[] = [
        { view: 'report', align: 'center', label: 'Report', icon: new URL('../../assets/glass-trend.png', import.meta.url).href },
        { view: 'config', align: 'center', label: 'Config', icon: new URL('../../assets/glass-adjust.png', import.meta.url).href },
        { view: 'schedule', align: 'center', label: 'Schedule', icon: new URL('../../assets/glass-schedule.png', import.meta.url).href },
        { view: 'about', align: 'center', label: 'About', icon: new URL('../../assets/glass-about.png', import.meta.url).href },
    ];

    return (
        <div className="nav-toolbar">
            {buttons.map(({ view, label, icon }) => (
                <button
                    key={view}
                    className={`nav-button ${activeView === view ? 'active' : ''}`}
                    onClick={() => onViewChange(view)}
                    aria-label={label}
                >
                    <img src={icon} alt={label} className="nav-icon" />
                    <span className="nav-label">{label}</span>
                </button>
            ))}
        </div>
    );
}

export default BottomToolbar;
