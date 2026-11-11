import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { EntityTitle } from './ui/entity-title';
import { Icon } from './ui/icon';
import { Input } from './ui/input';
import { Section, SectionCard } from './ui/section';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Switch } from './ui/switch';
import {
  DEFAULT_REPORT_SETTINGS,
  ReportingSchedule,
} from '../../../shared/types/settings.types';
import { useSettings } from '../hooks/useSettings';

interface DeliveryViewProps {
  isReadOnly?: boolean;
}

export function DeliveryView({ isReadOnly }: DeliveryViewProps = {}) {
  const { settings, loading: settingsLoading, updateSettings } = useSettings();
  const [schedules, setSchedules] = useState<ReportingSchedule[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasAppliedServer = useRef(false);

  useEffect(() => {
    if (!settingsLoading && settings && !hasAppliedServer.current) {
      hasAppliedServer.current = true;
      setSchedules(settings.report?.reportingSchedules || []);
    }
  }, [settingsLoading, settings]);

  const generateScheduleName = (schedule: ReportingSchedule): string => {
    const ampm = schedule.hour >= 12 ? 'PM' : 'AM';
    const h12 = schedule.hour % 12 || 12;
    const timeStr = `${String(h12).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')} ${ampm}`;

    if (schedule.scheduleType === 'daily') {
      return `Runs daily at ${timeStr}`;
    }
    if (schedule.scheduleType === 'weekly') {
      const days = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ];
      let selectedDays: number[] = [];
      if (Array.isArray(schedule.dayOfWeek)) {
        selectedDays = [...schedule.dayOfWeek].sort((a, b) => a - b);
      } else if (typeof schedule.dayOfWeek === 'number') {
        selectedDays = [schedule.dayOfWeek];
      } else {
        selectedDays = [1];
      }
      const dayList = selectedDays.map((d) => days[d]).join(', ');
      return `Runs on ${dayList} at ${timeStr}`;
    }
    if (schedule.scheduleType === 'monthly') {
      return `Runs on day ${schedule.dayOfMonth || 1} of the month at ${timeStr}`;
    }
    return 'New Report Schedule';
  };

  const handleAddSchedule = () => {
    const newSchedule: ReportingSchedule = {
      id: Math.random().toString(36).substring(2, 9),
      name: '',
      scheduleType: 'weekly',
      recipients: '',
      enabled: true,
      hour: 9,
      minute: 0,
      dayOfWeek: [1],
    };
    newSchedule.name = generateScheduleName(newSchedule);
    setSchedules((prev) => [...prev, newSchedule]);
    setIsDirty(true);
  };

  const handleUpdateSchedule = (
    id: string,
    updates: Partial<ReportingSchedule>
  ) => {
    setSchedules((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          const next = { ...s, ...updates };
          if (
            updates.scheduleType !== undefined ||
            updates.hour !== undefined ||
            updates.minute !== undefined ||
            updates.dayOfWeek !== undefined ||
            updates.dayOfMonth !== undefined
          ) {
            next.name = generateScheduleName(next);
          }
          return next;
        }
        return s;
      })
    );
    setIsDirty(true);
  };

  const handleRemoveSchedule = (id: string) => {
    setSchedules((prev) => prev.filter((s) => s.id !== id));
    setIsDirty(true);
  };

  const handleSave = async () => {
    if (isReadOnly || !settings) return;
    setSaving(true);
    const updated = {
      ...settings,
      report: {
        ...(settings.report || DEFAULT_REPORT_SETTINGS),
        reportingSchedules: schedules,
      },
    };
    const success = await updateSettings(updated);
    setSaving(false);
    if (success) {
      setIsDirty(false);
    }
  };

  const handleReset = () => {
    setSchedules(settings?.report?.reportingSchedules || []);
    setIsDirty(false);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg)] overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full p-2 sm:p-4 md:p-6 space-y-4 sm:space-y-6">
        {/* Header with Title and Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 pb-2 sm:pb-4 border-b border-border">
          <EntityTitle
            title="Delivery Schedules"
            subtitle="Configure routine report generation and distribution routines across Reddit"
            icon="mono-mail-by-timer"
          />

          <div className="flex items-center gap-1.5 sm:gap-2 self-start sm:self-center flex-wrap">
            {isDirty && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={isReadOnly || saving}
                title={
                  isReadOnly
                    ? 'Settings modification disabled in showcase mode'
                    : undefined
                }
                className="text-xs"
              >
                Discard
              </Button>
            )}
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={isReadOnly || !isDirty || saving}
              icon={saving ? 'lucide:refresh-cw' : 'lucide:save'}
              className="text-xs shadow-sm"
              title={
                isReadOnly
                  ? 'Settings modification disabled in showcase mode'
                  : undefined
              }
            >
              {saving ? 'Saving...' : isDirty ? 'Save Schedules' : 'Saved'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddSchedule}
              icon="lucide:plus"
              className="text-xs"
            >
              Add Schedule
            </Button>
          </div>
        </div>

        {/* Schedules List Section */}
        <Section title="Active Deliveries" icon="mono-mail-by-timer">
          <SectionCard>
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                  <span
                    className="w-1 h-4 rounded-full"
                    style={{ backgroundColor: 'var(--color-secondary)' }}
                  />
                  Delivery Schedules
                </h3>
                <span className="text-xs text-muted-foreground font-semibold">
                  {schedules.length} configured
                </span>
              </div>

              <p className="text-xs text-muted-foreground">
                Configure routine report generation and delivery patterns. Each
                schedule can have its own recipients and frequency.
              </p>

              <div className="space-y-4">
                {schedules.length === 0 ? (
                  <div className="p-10 border-2 border-dashed border-border rounded-xl text-center space-y-3 bg-muted/10">
                    <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
                      <Icon name="lucide:send" size={24} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        No delivery schedules configured
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                        Automate the distribution of your community analytical
                        reports directly to modmail or user inboxes.
                      </p>
                    </div>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleAddSchedule}
                      icon="lucide:plus"
                      className="mt-2"
                    >
                      Create First Schedule
                    </Button>
                  </div>
                ) : (
                  schedules.map((schedule) => (
                    <div
                      key={schedule.id}
                      className="p-4 bg-muted/20 rounded-lg border border-border/60 space-y-4 shadow-sm hover:border-border transition-colors"
                    >
                      <div className="flex justify-between items-center gap-3">
                        <div className="flex-1">
                          <Input
                            size="xs"
                            variant="filled"
                            value={schedule.name}
                            readOnly
                            disabled
                            className="font-bold cursor-not-allowed opacity-80"
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={schedule.enabled}
                            onCheckedChange={(c) =>
                              handleUpdateSchedule(schedule.id, {
                                enabled: !!c,
                              })
                            }
                          />
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => handleRemoveSchedule(schedule.id)}
                            icon="lucide:trash"
                            className="text-destructive hover:bg-destructive/10"
                            tooltip="Remove Schedule"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">
                            Frequency
                          </label>
                          <Select
                            value={schedule.scheduleType}
                            onValueChange={(val) =>
                              handleUpdateSchedule(schedule.id, {
                                scheduleType: val as any,
                              })
                            }
                          >
                            <SelectTrigger className="w-full h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="daily">Daily</SelectItem>
                              <SelectItem value="weekly">Weekly</SelectItem>
                              <SelectItem value="monthly">Monthly</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <label className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">
                            Delivery Time
                          </label>
                          <Select
                            value={String(schedule.hour)}
                            onValueChange={(val) =>
                              handleUpdateSchedule(schedule.id, {
                                hour: parseInt(val, 10),
                              })
                            }
                          >
                            <SelectTrigger className="w-full h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }).map((_, i) => (
                                <SelectItem key={i} value={String(i)}>
                                  {i % 12 || 12} {i >= 12 ? 'PM' : 'AM'}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {schedule.scheduleType === 'weekly' && (
                        <div>
                          <label className="text-[10px] font-bold text-muted-foreground uppercase mb-1.5 block">
                            Days of Week
                          </label>
                          <div className="flex gap-1.5 overflow-x-auto pb-1">
                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(
                              (day, idx) => {
                                const isSelected = Array.isArray(
                                  schedule.dayOfWeek
                                )
                                  ? schedule.dayOfWeek.includes(idx)
                                  : schedule.dayOfWeek === idx;

                                return (
                                  <Button
                                    key={`${day}-${idx}`}
                                    variant={
                                      schedule.enabled
                                        ? isSelected
                                          ? 'default'
                                          : 'outline'
                                        : 'ghost'
                                    }
                                    size="xs"
                                    square
                                    className={`w-8 h-8 font-bold ${
                                      !schedule.enabled && isSelected
                                        ? 'ring-1 ring-border bg-muted/40'
                                        : ''
                                    }`}
                                    onClick={() => {
                                      let currentDays: number[] = [];
                                      if (Array.isArray(schedule.dayOfWeek)) {
                                        currentDays = [...schedule.dayOfWeek];
                                      } else if (
                                        typeof schedule.dayOfWeek === 'number'
                                      ) {
                                        currentDays = [schedule.dayOfWeek];
                                      } else {
                                        currentDays = [1];
                                      }

                                      if (currentDays.includes(idx)) {
                                        currentDays = currentDays.filter(
                                          (d) => d !== idx
                                        );
                                      } else {
                                        currentDays.push(idx);
                                      }

                                      if (currentDays.length === 0) {
                                        currentDays = [idx];
                                      }

                                      handleUpdateSchedule(schedule.id, {
                                        dayOfWeek: currentDays,
                                      });
                                    }}
                                  >
                                    {day}
                                  </Button>
                                );
                              }
                            )}
                          </div>
                        </div>
                      )}

                      {schedule.scheduleType === 'monthly' && (
                        <div>
                          <label className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">
                            Day of Month
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="31"
                            value={schedule.dayOfMonth || 1}
                            onChange={(e) =>
                              handleUpdateSchedule(schedule.id, {
                                dayOfMonth: parseInt(e.target.value, 10),
                              })
                            }
                            className="w-full h-8 px-3 py-1.5 border border-border bg-background rounded-md text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      )}

                      <div>
                        <label className="text-[10px] font-bold text-muted-foreground uppercase mb-1 block">
                          Recipients
                        </label>
                        <Input
                          placeholder="u/username, r/subreddit"
                          value={schedule.recipients}
                          onChange={(e) =>
                            handleUpdateSchedule(schedule.id, {
                              recipients: e.target.value,
                            })
                          }
                          size="xs"
                        />
                        {schedule.recipients &&
                          (() => {
                            const parts = schedule.recipients
                              .split(',')
                              .map((p) => p.trim())
                              .filter(Boolean);
                            for (const part of parts) {
                              if (!part.match(/^(r\/|u\/)?[a-zA-Z0-9_-]+$/)) {
                                return (
                                  <p className="text-[10px] text-destructive mt-1">
                                    Invalid format: &quot;{part}&quot;. Use
                                    u/username or r/subreddit.
                                  </p>
                                );
                              }
                            }
                            return null;
                          })()}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </SectionCard>
        </Section>
      </div>
    </div>
  );
}

export default DeliveryView;
