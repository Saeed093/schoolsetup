import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './CardManager.css';

// Same-origin API (dev server proxies to backend; production runs on same host)
const getApiUrl = () => `/api/cards`;

function CardManager() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingCard, setEditingCard] = useState(null);
  const [formData, setFormData] = useState({ 
    card_id: '', 
    checkin_card_id: '',
    student_name: '', 
    student_class: '', 
    adult_name: '', 
    adult_image: '',
    child_image: '',
    alarm_enabled: false 
  });
  const [error, setError] = useState('');

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.card_id.trim() || !formData.student_name.trim()) {
      setError('Please fill in all fields');
      return;
    }

    try {
      if (editingCard) {
        // Update existing card
        await axios.put(`${getApiUrl()}/${editingCard.id}`, formData);
      } else {
        // Create new card
        await axios.post(getApiUrl(), formData);
      }
      
      setFormData({ card_id: '', checkin_card_id: '', student_name: '', student_class: '', adult_name: '', adult_image: '', child_image: '', alarm_enabled: false });
      setEditingCard(null);
      fetchCards();
    } catch (err) {
      if (err.response?.status === 409) {
        setError('Card ID already exists. Please use a different ID.');
      } else {
        setError(err.response?.data?.error || 'Failed to save card. Please try again.');
      }
    }
  };

  const handleImagePick = (kind, file) => {
    if (!file) {
      setFormData((prev) => ({ ...prev, [`${kind}_image`]: '' }));
      return;
    }

    // Keep payload reasonable (server JSON limit is 10mb)
    const MAX_BYTES = 3 * 1024 * 1024; // 3MB
    if (file.size > MAX_BYTES) {
      setError(`Image is too large. Please choose an image under ${Math.round(MAX_BYTES / (1024 * 1024))}MB.`);
      return;
    }

    if (!file.type?.startsWith('image/')) {
      setError('Please choose a valid image file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      setFormData((prev) => ({ ...prev, [`${kind}_image`]: dataUrl }));
    };
    reader.onerror = () => setError('Failed to read image file. Please try another image.');
    reader.readAsDataURL(file);
  };

  const clearImage = (kind) => {
    setFormData((prev) => ({ ...prev, [`${kind}_image`]: '' }));
  };

  const handleEdit = (card) => {
    setEditingCard(card);
    setFormData({ 
      card_id: card.card_id, 
      checkin_card_id: card.checkin_card_id ?? '',
      student_name: card.student_name ?? card.name ?? '', 
      student_class: card.student_class ?? '',
      adult_name: card.adult_name ?? '',
      adult_image: card.adult_image ?? '',
      child_image: card.child_image ?? '',
      alarm_enabled: card.alarm_enabled === 1
    });
    setError('');
  };

  const handleCancel = () => {
    setEditingCard(null);
    setFormData({ card_id: '', checkin_card_id: '', student_name: '', student_class: '', adult_name: '', adult_image: '', child_image: '', alarm_enabled: false });
    setError('');
  };

  const toggleAlarm = async (card) => {
    try {
      const newAlarmState = card.alarm_enabled === 1 ? false : true;
      await axios.put(`${getApiUrl()}/${card.id}`, {
        student_name: card.student_name,
        student_class: card.student_class,
        adult_name: card.adult_name ?? '',
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
    // Prefer numeric id; fallback to card_id (RFID) so delete always works and card can be reassigned
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

  return (
    <div className="card-manager">
      <div className="card-manager-header">
        <h2>📋 Card Management</h2>
      </div>

      <form onSubmit={handleSubmit} className="card-form">
        {/* RFID Cards Section */}
        <div className="form-section">
          <h4 className="form-section-title">RFID Cards</h4>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="card_id">🚗 Check-OUT Card (RFID)</label>
              <input
                type="text"
                id="card_id"
                value={formData.card_id}
                onChange={(e) => setFormData({ ...formData, card_id: e.target.value.toUpperCase() })}
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
                onChange={(e) => setFormData({ ...formData, checkin_card_id: e.target.value.toUpperCase() })}
                placeholder="Scan check-in card (optional)"
              />
              <small className="form-hint">Used when student arrives at school</small>
            </div>
          </div>
        </div>

        {/* Student Info Section */}
        <div className="form-section">
          <h4 className="form-section-title">Student Information</h4>
          
          <div className="form-group">
            <label htmlFor="student_name">Student Name</label>
          <input
            type="text"
            id="student_name"
            value={formData.student_name}
            onChange={(e) => setFormData({ ...formData, student_name: e.target.value })}
            placeholder="Enter student name"
          />
        </div>

        <div className="form-group">
          <label htmlFor="student_class">Student Class</label>
          <select
            id="student_class"
            value={formData.student_class}
            onChange={(e) => setFormData({ ...formData, student_class: e.target.value })}
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

        <div className="form-group">
          <label htmlFor="adult_name">Adult / Pickup Contact Name</label>
          <input
            type="text"
            id="adult_name"
            value={formData.adult_name}
            onChange={(e) => setFormData({ ...formData, adult_name: e.target.value })}
            placeholder="Name of adult who picks up this child"
          />
        </div>
        </div>

        {/* Photos Section */}
        <div className="form-section">
          <h4 className="form-section-title">Photos</h4>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="adult_image">Guardian Photo</label>
              <input
                type="file"
                id="adult_image"
                accept="image/*"
                onChange={(e) => handleImagePick('adult', e.target.files?.[0])}
              />
              {formData.adult_image ? (
                <div className="photo-preview">
                  <img src={formData.adult_image} alt="Guardian preview" />
                  <button type="button" className="btn btn-small btn-secondary" onClick={() => clearImage('adult')}>
                    Remove
                  </button>
                </div>
              ) : (
                <small className="form-hint">Upload the guardian/pickup person's photo (optional)</small>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="child_image">Child Photo</label>
              <input
                type="file"
                id="child_image"
                accept="image/*"
                onChange={(e) => handleImagePick('child', e.target.files?.[0])}
              />
              {formData.child_image ? (
                <div className="photo-preview">
                  <img src={formData.child_image} alt="Child preview" />
                  <button type="button" className="btn btn-small btn-secondary" onClick={() => clearImage('child')}>
                    Remove
                  </button>
                </div>
              ) : (
                <small className="form-hint">Upload the student's photo (optional)</small>
              )}
            </div>
          </div>
        </div>

        <div className="form-group form-group-checkbox">
          <label htmlFor="alarm_enabled" className="checkbox-label">
            <input
              type="checkbox"
              id="alarm_enabled"
              checked={formData.alarm_enabled}
              onChange={(e) => setFormData({ ...formData, alarm_enabled: e.target.checked })}
            />
            <span>🚨 Enable Device Alarm (triggers alarm when card is scanned)</span>
          </label>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            {editingCard ? 'Update Card' : 'Add Card'}
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
              <div key={card.id} className={`card-item ${card.alarm_enabled === 1 ? 'alarm-enabled' : ''}`}>
                <div className="card-info">
                  <div className="card-name">
                    {card.student_name ?? card.name}
                    {card.alarm_enabled === 1 && <span className="alarm-badge">🚨</span>}
                  </div>
                  {(card.adult_image || card.child_image) && (
                    <div className="card-photos-row">
                      {card.child_image && (
                        <img className="card-photo-thumb" src={card.child_image} alt="Child" />
                      )}
                      {card.adult_image && (
                        <img className="card-photo-thumb" src={card.adult_image} alt="Guardian" />
                      )}
                    </div>
                  )}
                  {!!(card.student_class ?? '') && (
                    <div className="card-id">Class: {card.student_class}</div>
                  )}
                  {!!(card.adult_name ?? '') && (
                    <div className="card-id">Adult: {card.adult_name}</div>
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
