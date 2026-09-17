import { useState, useCallback, useMemo } from 'react';
import type { AppEvent, ParticipantGender, ParticipantInfo } from '../types/index';
import './ParticipantInfoScreen.css';

interface ParticipantInfoScreenProps {
  dispatch: React.Dispatch<AppEvent>;
}

/** Selectable gender options presented in the intake form. */
const GENDER_OPTIONS: { value: ParticipantGender; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const MIN_AGE = 1;
const MAX_AGE = 120;

/**
 * ParticipantInfoScreen — intake form shown after Welcome and before the safety
 * checklist.
 *
 * Collects the participant details that must be keyed in at the beginning of a
 * session:
 *  - Name (free text)
 *  - Gender
 *  - Age (whole years)
 *  - A declaration / consent acknowledgement (required)
 *
 * It also captures the date and time the test is started (an ISO 8601
 * `testDateTime`) at the moment the form is submitted. All of this is passed up
 * via the `PARTICIPANT_INFO_SUBMITTED` event and carried through to the final
 * assessment so it can be shown on the results screen and, if the operator has
 * enabled the optional Google Sheets export, written alongside the metrics.
 *
 * Nothing entered here leaves the device unless the Sheets export is explicitly
 * configured.
 */
export function ParticipantInfoScreen({ dispatch }: ParticipantInfoScreenProps) {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<ParticipantGender | ''>('');
  const [age, setAge] = useState('');
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const trimmedName = name.trim();
  const ageNumber = Number.parseInt(age, 10);
  const ageValid =
    age.trim() !== '' &&
    Number.isFinite(ageNumber) &&
    ageNumber >= MIN_AGE &&
    ageNumber <= MAX_AGE;

  const nameValid = trimmedName.length >= 1;
  const genderValid = gender !== '';

  const formValid = useMemo(
    () => nameValid && genderValid && ageValid && declarationAccepted,
    [nameValid, genderValid, ageValid, declarationAccepted]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setAttemptedSubmit(true);
      if (!formValid || gender === '') return;

      const participant: ParticipantInfo = {
        name: trimmedName,
        gender,
        age: ageNumber,
        declarationAccepted: true,
        // Capture the exact moment the test session begins.
        testDateTime: new Date().toISOString(),
      };
      dispatch({ type: 'PARTICIPANT_INFO_SUBMITTED', participant });
    },
    [formValid, gender, trimmedName, ageNumber, dispatch]
  );

  const handleCancel = useCallback(() => {
    dispatch({ type: 'BACK_TO_WELCOME' });
  }, [dispatch]);

  return (
    <div className="participant-screen" role="region" aria-label="Participant Information">
      <header className="participant-screen__header">
        <h1 className="participant-screen__title">Before we begin</h1>
        <p className="participant-screen__description">
          Please enter your details. This information is stored on your device
          with your results and is only sent onward if the operator has enabled
          data collection.
        </p>
      </header>

      <form className="participant-screen__form" onSubmit={handleSubmit} noValidate>
        {/* Name */}
        <div className="participant-screen__field">
          <label className="participant-screen__label" htmlFor="participant-name">
            Full name
          </label>
          <input
            id="participant-name"
            className="participant-screen__input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            aria-required="true"
            aria-invalid={attemptedSubmit && !nameValid}
            aria-describedby={attemptedSubmit && !nameValid ? 'participant-name-error' : undefined}
            placeholder="e.g. Alex Tan"
          />
          {attemptedSubmit && !nameValid && (
            <span id="participant-name-error" className="participant-screen__error" role="alert">
              Please enter your name.
            </span>
          )}
        </div>

        {/* Gender */}
        <div className="participant-screen__field">
          <label className="participant-screen__label" htmlFor="participant-gender">
            Gender
          </label>
          <select
            id="participant-gender"
            className="participant-screen__input participant-screen__select"
            value={gender}
            onChange={(e) => setGender(e.target.value as ParticipantGender)}
            aria-required="true"
            aria-invalid={attemptedSubmit && !genderValid}
            aria-describedby={
              attemptedSubmit && !genderValid ? 'participant-gender-error' : undefined
            }
          >
            <option value="" disabled>
              Select…
            </option>
            {GENDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {attemptedSubmit && !genderValid && (
            <span id="participant-gender-error" className="participant-screen__error" role="alert">
              Please select a gender.
            </span>
          )}
        </div>

        {/* Age */}
        <div className="participant-screen__field">
          <label className="participant-screen__label" htmlFor="participant-age">
            Age (years)
          </label>
          <input
            id="participant-age"
            className="participant-screen__input"
            type="number"
            inputMode="numeric"
            min={MIN_AGE}
            max={MAX_AGE}
            step={1}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            aria-required="true"
            aria-invalid={attemptedSubmit && !ageValid}
            aria-describedby={attemptedSubmit && !ageValid ? 'participant-age-error' : undefined}
            placeholder="e.g. 42"
          />
          {attemptedSubmit && !ageValid && (
            <span id="participant-age-error" className="participant-screen__error" role="alert">
              Please enter a valid age between {MIN_AGE} and {MAX_AGE}.
            </span>
          )}
        </div>

        {/* Declaration / consent */}
        <fieldset className="participant-screen__declaration">
          <legend className="participant-screen__declaration-legend">Declaration</legend>
          <label className="participant-screen__checkbox-label">
            <input
              type="checkbox"
              className="participant-screen__checkbox"
              checked={declarationAccepted}
              onChange={(e) => setDeclarationAccepted(e.target.checked)}
              aria-required="true"
              aria-invalid={attemptedSubmit && !declarationAccepted}
            />
            <span className="participant-screen__checkbox-text">
              I confirm that the details above are accurate, that I am taking this
              screening voluntarily, and I understand this tool is a research
              prototype and screening aid — <strong>not a medical device</strong> and
              not a substitute for examination by a qualified clinician. I consent
              to my details and screening results being recorded for this session.
            </span>
          </label>
          {attemptedSubmit && !declarationAccepted && (
            <span className="participant-screen__error" role="alert">
              You must accept the declaration to continue.
            </span>
          )}
        </fieldset>

        <div className="participant-screen__actions">
          <button
            className="participant-screen__btn participant-screen__btn--primary"
            type="submit"
            disabled={!formValid}
            aria-disabled={!formValid}
          >
            Continue
          </button>
          <button
            className="participant-screen__btn participant-screen__btn--secondary"
            type="button"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      </form>

      <p className="participant-screen__privacy">
        The date and time of this test are recorded automatically when you
        continue.
      </p>
    </div>
  );
}
