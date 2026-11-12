import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { api, ApiError } from '../api/client';
import type { User, UserRole } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/Icons';
import {
  EmptyState,
  ErrorNote,
  Modal,
  PageHeader,
  Spinner,
} from '../components/ui';

const AddUserForm = ({
  onCancel,
  onDone,
}: {
  onCancel: () => void;
  onDone: (message: string) => void;
}) => {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'staff' as UserRole });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.createUser({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
      });
      onDone(`${form.name.trim()} added as ${form.role}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'User could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-grid" onSubmit={submit}>
      <label className="field">
        <span>Name</span>
        <input
          required
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          required
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          minLength={8}
          required
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Role</span>
        <select
          value={form.role}
          onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}
        >
          <option value="staff">Staff — sell and view</option>
          <option value="admin">Admin — full control</option>
        </select>
      </label>
      {error ? <div className="field-span"><ErrorNote>{error}</ErrorNote></div> : null}
      <div className="form-actions field-span">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add team member'}
        </button>
      </div>
    </form>
  );
};

export const TeamPage = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.listUsers();
      setUsers(result.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Team members could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRole = async (member: User, role: UserRole) => {
    setUpdatingId(member.id);
    setError('');
    try {
      const updated = await api.updateUserRole(member.id, role);
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setNotice(`${updated.name} is now ${updated.role}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Role could not be updated.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Access control"
        title="The people behind the counter."
        description="Admins manage products, stock, and roles. Staff can view the workspace and record sales."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setFormOpen(true)}>
            <Icon name="plus" /> Add member
          </button>
        }
      />

      {notice ? <div className="notice" role="status">{notice}</div> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <section className="panel panel-table">
        {loading ? (
          <Spinner label="Loading team…" />
        ) : users.length === 0 ? (
          <EmptyState title="No users found" body="Add the first team member to share this workspace." />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th aria-label="Change role" />
                </tr>
              </thead>
              <tbody>
                {users.map((member) => {
                  const isSelf = member.id === user?.id;
                  return (
                    <tr key={member.id}>
                      <td>
                        <div className="cell-title">
                          <strong>
                            {member.name} {isSelf ? <span className="muted">(you)</span> : null}
                          </strong>
                        </div>
                      </td>
                      <td className="mono">{member.email}</td>
                      <td>
                        <span className={`badge ${member.role === 'admin' ? 'badge-accent' : 'badge-neutral'}`}>
                          {member.role}
                        </span>
                      </td>
                      <td>
                        <select
                          aria-label={`Role for ${member.name}`}
                          value={member.role}
                          disabled={isSelf || updatingId === member.id}
                          onChange={(event) => void changeRole(member, event.target.value as UserRole)}
                        >
                          <option value="staff">staff</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {formOpen ? (
        <Modal title="Add team member" onClose={() => setFormOpen(false)}>
          <AddUserForm
            onCancel={() => setFormOpen(false)}
            onDone={(message) => {
              setFormOpen(false);
              setNotice(message);
              void load();
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
};
