import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './CardManager.css';
import {
  loadFaceModelsOnce,
  descriptorFromDataUrlRobust
} from '../utils/faceVerification';

const getApiUrl = () => `/api/cards`;

const MAX_GUARDIANS = 5;
/** Per-image cap (bytes). PNGs can be large; server JSON limit is 70mb total. */
const MAX_IMAGE_BYTES = 9 * 1024 * 1024;

function newGuardianKey() {
  return `g_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

const emptyGuardian = () => ({
  _key: newGuardianKey(),
  name: '',
  relation: 'father',
  relationOther: '',
  image: '',
  descriptor: null
});

function parseGuardiansFromCard(card) {
  if (!card) return [emptyGuardian()];
  try {
    if (card.guardians_json) {
      const arr = JSON.parse(card.guardians_json);
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((g) => ({
          _key: newGuardianKey(),
          name: g.name || '',
          relation: ['father', 'mother', 'driver', 'other'].includes(g.relation)
            ? g.relation
            : 'other',
          relationOther: g.relationOther || '',
          image: g.image || '',
          descriptor: Array.isArray(g.descriptor) ? g.descriptor : null
        }));
      }
    }
  } catch {
    /* ignore */
  }
  if (card.adult_name || card.adult_image) {
    return [
      {
        _key: newGuardianKey(),
        name: card.adult_name || '',
        relation: 'other',
        relationOther: '',
        image: card.adult_image || '',
        descriptor: null
      }
    ];
  }
  return [emptyGuardian()];
}

function CardManager() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingCard, setEditingCard] = useState(null);
  const [formData, setFormData] = useState({
    card_id: '',
    checkin_card_id: '',
    student_name: '',
    student_class: '',
    child_image: '',
    alarm_enabled: false
  });
  const [guardians, setGuardians] = useState([emptyGuardian()]);
  const [error, setError] = useState('');
  const [savingFaces, setSavingFaces] = useState(false);
  /** null | 'faces' (ML) | 'upload' (HTTP) */
  const [savePhase, setSavePhase] = useState(null);
  const [uploadPercent, setUploadPercent] = useState(null);
  /** Loading large file into memory before it appears in the form (0–100 or null) */
  const [fileLoadPercent, setFileLoadPercent] = useState(null);

  useEffect(() => {
    fetchCards();
  }, []);

  const fetchCards = async () => {
    try {
      setLoading(true);
      const response = await axios.get(getApiUrl());
      setCards(response.data);
      setError('');
    } catch (err) {
      setError('Failed to load cards. Please try again.');
      console.error('Error fetching cards:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateGuardian = (index, patch) => {
    setGuardians((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const addGuardianRow = () => {
    if (guardians.length >= MAX_GUARDIANS) return;
    setGuardians((prev) => [...prev, emptyGuardian()]);
  };

  const removeGuardianRow = (index) => {
    setGuardians((prev) => {
      if (prev.length <= 1) return [emptyGuardian()];
      return prev.filter((_, i) => i !== index);
    });
  };

  /** Rows the user is actually using (any field set). Blank template rows are ignored. */
  const activeGuardianIndexes = () => {
    const idxs = [];
    guardians.forEach((g, i) => {
      const name = (g.name || '').trim();
      const hasImg = !!(g.image || '').trim();
      const hasDesc = Array.isArray(g.descriptor) && g.descriptor.length === 128;
      if (name || hasImg || hasDesc) idxs.push(i);
    });
    return idxs;
  };

  const validateGuardiansForSubmit = () => {
    const active = activeGuardianIndexes();
    if (active.length === 0) {
      setError('Add at least one guardian with name and photo.');
      return false;
    }
    for (const i of active) {
      const g = guardians[i];
      const name = (g.name || '').trim();
      const hasImg = !!(g.image || '').trim();
      const hasDesc = Array.isArray(g.descriptor) && g.descriptor.length === 128;
      if (!name) {
        setError(`Guardian ${i + 1}: name is required.`);
        return false;
      }
      if (!hasImg && !hasDesc) {
        setError(
          `Guardian ${i + 1} (${name}): photo is required for pickup face matching.`
        );
        return false;
      }
    }
    return true;
  };

  const handleGuardianImagePick = (index, file) => {
    if (!file) {
      updateGuardian(index, { image: '', descriptor: null });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(
        `Image is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max per image is ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB.`
      );
      return;
    }
    if (!file.type?.startsWith('image/')) {
      setError('Please choose a valid image file.');
      return;
    }
    const reader = new FileReader();
    const showLoad = file.size >= 512 * 1024;
    if (showLoad) {
      setFileLoadPercent(0);
    }
    reader.onprogress = (ev) => {
      if (showLoad && ev.lengthComputable) {
        setFileLoadPercent(Math.round((100 * ev.loaded) / ev.total));
      }
    };
    reader.onload = () => {
      setFileLoadPercent(null);
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      updateGuardian(index, { image: dataUrl, descriptor: null });
    };
    reader.onerror = () => {
      setFileLoadPercent(null);
      setError('Failed to read image file. Please try another image.');
    };
    reader.readAsDataURL(file);
  };

  const buildGuardiansPayload = async () => {
    await loadFaceModelsOnce();
    const out = [];
    for (let i = 0; i < guardians.length; i++) {
      const g = guardians[i];
      const name = (g.name || '').trim();
      const relOther = g.relation === 'other' ? (g.relationOther || '').trim() : '';
      if (!name && !g.image && !g.descriptor) continue;

      let descriptor = g.descriptor;
      const img = g.image || '';

      if (img.startsWith('data:')) {
        const d = await descriptorFromDataUrlRobust(img);
        if (!d) {
          throw new Error(
            `No face detected in guardian ${i + 1} photo. Use a clear face photo or remove the image.`
          );
        }
        descriptor = Array.from(d);
      } else if (img && (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128)) {
        try {
          const origin = window.location.origin;
          const url = img.startsWith('http') ? img : `${origin}${img.startsWith('/') ? '' : '/'}${img}`;
          const d = await descriptorFromDataUrlRobust(url);
          if (d) descriptor = Array.from(d);
        } catch {
          /* keep null */
        }
      }

      if (!img && !(descriptor && descriptor.length === 128)) {
        throw new Error(
          `Guardian ${i + 1}: photo is required. Upload a face photo or remove this row.`
        );
      }

      out.push({
        name,
        relation: g.relation,
        relationOther: relOther,
        image: img,
        descriptor: descriptor && descriptor.length === 128 ? descriptor : null
      });
    }
    return out;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.card_id.trim() || !formData.student_name.trim()) {
      setError('Please fill in all required fields');
      return;
    }

    if (!validateGuardiansForSubmit()) {
      return;
    }

    const uploadConfig = {
      onUploadProgress: (ev) => {
        if (ev.lengthComputable) {
          setUploadPercent(Math.min(100, Math.round((100 * ev.loaded) / ev.total)));
        }
      }
    };

    try {
      setSavingFaces(true);
      setSavePhase('faces');
      setUploadPercent(null);
      const guardiansPayload = await buildGuardiansPayload();
      const body = {
        ...formData,
        guardians: guardiansPayload
      };

      setSavePhase('upload');
      setUploadPercent(0);
      if (editingCard) {
        await axios.put(`${getApiUrl()}/${editingCard.id}`, body, uploadConfig);
      } else {
        await axios.post(getApiUrl(), body, uploadConfig);
      }

      setFormData({
        card_id: '',
        checkin_card_id: '',
        student_name: '',
        student_class: '',
        child_image: '',
        alarm_enabled: false
      });
      setGuardians([emptyGuardian()]);
      setEditingCard(null);
      fetchCards();
    } catch (err) {
      const status = err.response?.status;
      let msg =
        typeof err.message === 'string' && err.message.includes('No face detected')
          ? err.message
          : err.response?.data?.error || err.message || 'Failed to save card. Please try again.';
      if (status === 413) {
        msg =
          'Request too large for the server. Try fewer/smaller images, or ask your admin to raise the upload limit.';
      }
      setError(msg);
      console.error('Save card error:', err);
    } finally {
      setSavingFaces(false);
      setSavePhase(null);
      setUploadPercent(null);
    }
  };

  const handleImagePickChild = (file) => {
    if (!file) {
      setFormData((prev) => ({ ...prev, child_image: '' }));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(
        `Image is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max per image is ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB.`
      );
      return;
    }
    if (!file.type?.startsWith('image/')) {
      setError('Please choose a valid image file.');
      return;
    }
    const reader = new FileReader();
    const showLoad = file.size >= 512 * 1024;
    if (showLoad) {
      setFileLoadPercent(0);
    }
    reader.onprogress = (ev) => {
      if (showLoad && ev.lengthComputable) {
        setFileLoadPercent(Math.round((100 * ev.loaded) / ev.total));
      }
    };
    reader.onload = () => {
      setFileLoadPercent(null);
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      setFormData((prev) => ({ ...prev, child_image: dataUrl }));
    };
    reader.onerror = () => {
      setFileLoadPercent(null);
      setError('Failed to read image file. Please try another image.');
    };
    reader.readAsDataURL(file);
  };

  const clearChildImage = () => {
    setFormData((prev) => ({ ...prev, child_image: '' }));
  };

  const handleEdit = (card) => {
    setEditingCard(card);
    setFormData({
      card_id: card.card_id,
      checkin_card_id: card.checkin_card_id ?? '',
      student_name: card.student_name ?? card.name ?? '',
      student_class: card.student_class ?? '',
      child_image: card.child_image ?? '',
      alarm_enabled: card.alarm_enabled === 1
    });
    setGuardians(parseGuardiansFromCard(card));
    setError('');
  };

  const handleCancel = () => {
    setEditingCard(null);
    setFormData({
      card_id: '',
      checkin_card_id: '',
      student_name: '',
      student_class: '',
      child_image: '',
      alarm_enabled: false
    });
    setGuardians([emptyGuardian()]);
    setError('');
  };

  const toggleAlarm = async (card) => {
    try {
      const newAlarmState = card.alarm_enabled === 1 ? false : true;
      await axios.put(`${getApiUrl()}/${card.id}`, {
        student_name: card.student_name,
        student_class: card.student_class,
        card_id: card.card_id,
        checkin_card_id: card.checkin_card_id ?? '',
        alarm_enabled: newAlarmState
      });
      fetchCards();
    } catch (err) {
      setError('Failed to update alarm setting. Please try again.');
      console.error('Error updating alarm:', err);
    }
  };

  const handleDelete = async (card) => {
    if (!window.confirm('Are you sure you want to delete this card?')) {
      return;
    }
    const idOrCardId = card.id ?? card.card_id;
    if (idOrCardId == null || idOrCardId === '') {
      setError('Cannot delete: card has no id.');
      return;
    }

    try {
      await axios.delete(`${getApiUrl()}/${encodeURIComponent(idOrCardId)}`);
      setError('');
      fetchCards();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete card. Please try again.');
      console.error('Error deleting card:', err);
    }
  };

  const guardianThumbsForList = (card) => {
    const list = parseGuardiansFromCard(card);
    return list.filter((g) => g.image);
  };

  return (
    <div className="card-manager">
      <div className="card-manager-header">
        <h2>Register or edit a card</h2>
      </div>

      <form onSubmit={handleSubmit} className="card-form">
        <div className="form-section">
          <h4 className="form-section-title">RFID Cards</h4>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="card_id">🚗 Check-OUT Card (RFID)</label>
              <input
                type="text"
                id="card_id"
                value={formData.card_id}
                onChange={(e) =>
                  setFormData({ ...formData, card_id: e.target.value.toUpperCase() })
                }
                placeholder="Scan check-out card"
                disabled={!!editingCard}
              />
              <small className="form-hint">Used when student leaves school</small>
            </div>

            <div className="form-group">
              <label htmlFor="checkin_card_id">🏫 Check-IN Card (RFID)</label>
              <input
                type="text"
                id="checkin_card_id"
                value={formData.checkin_card_id}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    checkin_card_id: e.target.value.toUpperCase()
                  })
                }
                placeholder="Scan check-in card (optional)"
              />
              <small className="form-hint">Used when student arrives at school</small>
            </div>
          </div>
        </div>

        <div className="form-section">
          <h4 className="form-section-title">Student Information</h4>

          <div className="form-group">
            <label htmlFor="student_name">Student Name</label>
            <input
              type="text"
              id="student_name"
              value={formData.student_name}
              onChange={(e) =>
                setFormData({ ...formData, student_name: e.target.value })
              }
              placeholder="Enter student name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="student_class">Student Class</label>
            <select
              id="student_class"
              value={formData.student_class}
              onChange={(e) =>
                setFormData({ ...formData, student_class: e.target.value })
              }
            >
              <option value="">-- Select Class --</option>
              <option value="Prenursery">Prenursery</option>
              <option value="Nursery">Nursery</option>
              <option value="1">Class 1</option>
              <option value="2">Class 2</option>
              <option value="3">Class 3</option>
              <option value="4">Class 4</option>
              <option value="5">Class 5</option>
            </select>
          </div>
        </div>

        <div className="form-section">
          <h4 className="form-section-title">
            Guardians (up to {MAX_GUARDIANS}) — photos used for pickup face check
          </h4>
          <p className="form-hint guardian-section-intro">
            Each guardian needs a <strong>name</strong> and a <strong>photo</strong> (clear face) for
            pickup matching. For &quot;Other&quot;, describe the role. Use{' '}
            <strong>Remove this guardian</strong> to drop extra rows, or <strong>Clear photo</strong>{' '}
            to replace an image.
          </p>

          {guardians.map((g, index) => (
            <div key={g._key} className="guardian-row">
              <div className="guardian-row-header">
                <span className="guardian-row-title">Guardian {index + 1}</span>
                {guardians.length > 1 ? (
                  <button
                    type="button"
                    className="btn btn-small guardian-remove-btn"
                    onClick={() => removeGuardianRow(index)}
                    title="Remove this guardian from the list"
                  >
                    Remove this guardian
                  </button>
                ) : (
                  <span className="guardian-remove-hint">At least one guardian required</span>
                )}
              </div>
              <div className="form-row guardian-fields">
                <div className="form-group">
                  <label>Name (required)</label>
                  <input
                    type="text"
                    value={g.name}
                    onChange={(e) => updateGuardian(index, { name: e.target.value })}
                    placeholder="Full name"
                  />
                </div>
                <div className="form-group">
                  <label>Type</label>
                  <select
                    value={g.relation}
                    onChange={(e) =>
                      updateGuardian(index, { relation: e.target.value, relationOther: '' })
                    }
                  >
                    <option value="father">Father</option>
                    <option value="mother">Mother</option>
                    <option value="driver">Driver</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              {g.relation === 'other' && (
                <div className="form-group">
                  <label>Describe role (Other)</label>
                  <input
                    type="text"
                    value={g.relationOther}
                    onChange={(e) =>
                      updateGuardian(index, { relationOther: e.target.value })
                    }
                    placeholder="e.g. Aunt, Grandparent"
                  />
                </div>
              )}
              <div className="form-group">
                <label>Photo (required)</label>
                <input
                  key={`${g._key}-file-${g.image ? 'has' : 'empty'}`}
                  type="file"
                  accept="image/*"
                  onChange={(e) =>
                    handleGuardianImagePick(index, e.target.files?.[0])
                  }
                />
                {g.image ? (
                  <div className="photo-preview guardian-photo-preview">
                    <img src={g.image} alt={`Guardian ${index + 1}`} />
                    <button
                      type="button"
                      className="btn btn-small btn-clear-photo"
                      onClick={() => updateGuardian(index, { image: '', descriptor: null })}
                    >
                      Clear photo
                    </button>
                  </div>
                ) : (
                  <small className="form-hint">
                    Required — face clearly visible (used at Capture Station for YES/NO match). Max{' '}
                    {Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB per image.
                  </small>
                )}
              </div>
            </div>
          ))}

          {guardians.length < MAX_GUARDIANS && (
            <button type="button" className="btn btn-secondary add-guardian-btn" onClick={addGuardianRow}>
              + Add guardian
            </button>
          )}
        </div>

        <div className="form-section">
          <h4 className="form-section-title">Photos</h4>

          <div className="form-group">
            <label htmlFor="child_image">Child Photo</label>
            <input
              type="file"
              id="child_image"
              accept="image/*"
              onChange={(e) => handleImagePickChild(e.target.files?.[0])}
            />
            {formData.child_image ? (
              <div className="photo-preview">
                <img src={formData.child_image} alt="Child preview" />
                <button
                  type="button"
                  className="btn btn-small btn-secondary"
                  onClick={clearChildImage}
                >
                  Remove
                </button>
              </div>
            ) : (
              <small className="form-hint">
                Optional — max {Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB per image
              </small>
            )}
          </div>
        </div>

        <div className="form-group form-group-checkbox">
          <label htmlFor="alarm_enabled" className="checkbox-label">
            <input
              type="checkbox"
              id="alarm_enabled"
              checked={formData.alarm_enabled}
              onChange={(e) =>
                setFormData({ ...formData, alarm_enabled: e.target.checked })
              }
            />
            <span>🚨 Enable Device Alarm (triggers alarm when card is scanned)</span>
          </label>
        </div>

        {fileLoadPercent !== null && (
          <div className="save-progress-panel file-load-progress" aria-live="polite">
            <p>Reading image into browser… {fileLoadPercent}%</p>
            <div className="progress-bar determinate">
              <div
                className="progress-bar-fill"
                style={{ width: `${fileLoadPercent}%` }}
              />
            </div>
          </div>
        )}

        {savingFaces && savePhase && (
          <div className="save-progress-panel" aria-live="polite">
            {savePhase === 'faces' && (
              <>
                <p>Analyzing guardian photos and face data (large images can take a while)…</p>
                <div className="progress-bar indeterminate" />
              </>
            )}
            {savePhase === 'upload' && (
              <>
                <p>
                  Uploading to server
                  {uploadPercent != null ? ` — ${uploadPercent}%` : '…'}
                </p>
                <div className="progress-bar determinate">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${uploadPercent ?? 0}%` }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {error && <div className="error-message">{error}</div>}

        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={savingFaces || fileLoadPercent !== null}
          >
            {savingFaces ? 'Saving…' : editingCard ? 'Update Card' : 'Add Card'}
          </button>
          {editingCard && (
            <button type="button" onClick={handleCancel} className="btn btn-secondary">
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="cards-list">
        <h3>Registered Cards ({cards.length})</h3>
        {loading ? (
          <div className="loading">Loading cards...</div>
        ) : cards.length === 0 ? (
          <div className="empty-state">No cards registered yet. Add your first card above!</div>
        ) : (
          <div className="cards-grid">
            {cards.map((card) => (
              <div
                key={card.id}
                className={`card-item ${card.alarm_enabled === 1 ? 'alarm-enabled' : ''}`}
              >
                <div className="card-info">
                  <div className="card-name">
                    {card.student_name ?? card.name}
                    {card.alarm_enabled === 1 && <span className="alarm-badge">🚨</span>}
                  </div>
                  {(guardianThumbsForList(card).length > 0 || card.child_image) && (
                    <div className="card-photos-row">
                      {card.child_image && (
                        <img className="card-photo-thumb" src={card.child_image} alt="Child" />
                      )}
                      {guardianThumbsForList(card).map((g, gi) => (
                        <img
                          key={gi}
                          className="card-photo-thumb"
                          src={g.image}
                          alt={g.name || 'Guardian'}
                          title={g.name || ''}
                        />
                      ))}
                    </div>
                  )}
                  {!!(card.student_class ?? '') && (
                    <div className="card-id">Class: {card.student_class}</div>
                  )}
                  {!!(card.adult_name ?? '') && (
                    <div className="card-id">Primary contact: {card.adult_name}</div>
                  )}
                  <div className="card-ids-row">
                    <div className="card-id card-id-checkout">
                      <span className="card-id-label">🚗 OUT:</span> {card.card_id}
                    </div>
                    {!!(card.checkin_card_id ?? '') && (
                      <div className="card-id card-id-checkin">
                        <span className="card-id-label">🏫 IN:</span> {card.checkin_card_id}
                      </div>
                    )}
                  </div>
                  {card.alarm_enabled === 1 && (
                    <div className="alarm-status">Device Alarm Enabled</div>
                  )}
                </div>
                <div className="card-actions">
                  <button
                    onClick={() => toggleAlarm(card)}
                    className={`btn btn-small ${card.alarm_enabled === 1 ? 'btn-alarm-on' : 'btn-alarm-off'}`}
                    title={card.alarm_enabled === 1 ? 'Disable alarm' : 'Enable alarm'}
                  >
                    {card.alarm_enabled === 1 ? '🔔' : '🔕'}
                  </button>
                  <button
                    onClick={() => handleEdit(card)}
                    className="btn btn-small btn-edit"
                    title="Edit card"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => handleDelete(card)}
                    className="btn btn-small btn-delete"
                    title="Delete card"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CardManager;
