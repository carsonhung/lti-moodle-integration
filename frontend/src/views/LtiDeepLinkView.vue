<template>
  <div class="deeplink-page">
    <div class="deeplink-card">
      <header class="deeplink-header">
        <div class="deeplink-header-icon">
          <i class="fa-solid fa-link"></i>
        </div>
        <div class="deeplink-header-text">
          <h1 class="deeplink-title">{{ pageData?.title || 'Configure Activity' }}</h1>
          <p v-if="pageData?.email" class="deeplink-subtitle">
            Signed in via Moodle as <strong>{{ pageData.email }}</strong>
          </p>
        </div>
      </header>

      <div v-if="errorMessage" class="deeplink-error">
        <i class="fa-solid fa-circle-exclamation"></i>
        <span>{{ errorMessage }}</span>
      </div>

      <div v-if="isLoadingData" class="deeplink-loading">
        <div class="deeplink-loading-icon">
          <i class="fa-solid fa-spinner fa-spin"></i>
        </div>
        <span>Loading…</span>
      </div>

      <template v-else-if="pageData && !pageData.error">
        <div class="deeplink-section">
          <label for="dl-course" class="deeplink-label">
            <i class="fa-solid fa-graduation-cap"></i>
            Course
          </label>
          <select
            id="dl-course"
            v-model="selectedCourseId"
            class="deeplink-select"
            @change="onCourseChange"
          >
            <option value="">Select a course…</option>
            <optgroup v-if="pageData.suggestedCourses?.length" label="My courses">
              <option v-for="c in pageData.courses" :key="c._id" :value="c._id">
                {{ formatCourseLabel(c) }}
              </option>
            </optgroup>
            <optgroup v-if="pageData.suggestedCourses?.length" label="Suggested matches">
              <option v-for="c in pageData.suggestedCourses" :key="c._id" :value="c._id">
                {{ formatCourseLabel(c) }}
              </option>
            </optgroup>
            <template v-if="!pageData.suggestedCourses?.length">
              <option v-for="c in pageData.courses" :key="c._id" :value="c._id">
                {{ formatCourseLabel(c) }}
              </option>
            </template>
          </select>
          <p class="deeplink-hint">Maps this Moodle course to a course in the app.</p>
        </div>

        <div v-if="selectedCourseId && categorySupported" class="deeplink-section">
          <div class="deeplink-toggle">
            <button
              type="button"
              class="deeplink-toggle-btn"
              :class="{ active: bindingType === 'agent' }"
              @click="bindingType = 'agent'"
            >
              <i class="fa-solid fa-robot"></i>
              Single {{ pageData.resourceLabel || 'resource' }}
            </button>
            <button
              type="button"
              class="deeplink-toggle-btn"
              :class="{ active: bindingType === 'category' }"
              @click="bindingType = 'category'"
            >
              <i class="fa-solid fa-folder-open"></i>
              Category
            </button>
          </div>
        </div>

        <div v-if="bindingType === 'agent'" class="deeplink-section">
          <label class="deeplink-label">
            <i class="fa-solid fa-robot"></i>
            {{ pageData.resourceLabel || 'Resource' }}
          </label>

          <div v-if="selectedCourseId" class="deeplink-search-row">
            <i class="fa-solid fa-magnifying-glass deeplink-search-icon"></i>
            <input
              v-model="publicSearchQuery"
              type="text"
              placeholder="Search public resources (type 2+ chars)"
              class="deeplink-search-input"
              @input="onSearchInput"
            />
          </div>

          <div v-if="isLoadingAgents" class="deeplink-loading-inline">
            <i class="fa-solid fa-spinner fa-spin"></i>
            <span>Loading resources…</span>
          </div>

          <div v-else-if="!selectedCourseId" class="deeplink-empty">
            <i class="fa-solid fa-arrow-up-long"></i>
            <span>Select a course first.</span>
          </div>

          <div v-else-if="agents.length === 0" class="deeplink-empty">
            <i class="fa-solid fa-robot"></i>
            <span>No resources found.</span>
          </div>

          <div v-else class="deeplink-list">
            <template v-if="courseAgents.length">
              <div class="deeplink-group-header">Course resources</div>
              <button
                v-for="a in courseAgents"
                :key="a._id"
                class="deeplink-item"
                :class="{ selected: selectedAgentId === a._id }"
                type="button"
                @click="selectedAgentId = a._id"
              >
                <span class="deeplink-item-name">{{ a.name }}</span>
                <i
                  v-if="selectedAgentId === a._id"
                  class="fa-solid fa-circle-check deeplink-check"
                ></i>
              </button>
            </template>

            <template v-if="publicAgents.length">
              <div class="deeplink-group-header">Public resources</div>
              <button
                v-for="a in publicAgents"
                :key="a._id"
                class="deeplink-item"
                :class="{ selected: selectedAgentId === a._id }"
                type="button"
                @click="selectedAgentId = a._id"
              >
                <span class="deeplink-item-name">{{ a.name }}</span>
                <span class="deeplink-badge public">Public</span>
                <i
                  v-if="selectedAgentId === a._id"
                  class="fa-solid fa-circle-check deeplink-check"
                ></i>
              </button>
            </template>
          </div>
        </div>

        <div v-if="bindingType === 'category'" class="deeplink-section">
          <label class="deeplink-label">
            <i class="fa-solid fa-folder-open"></i>
            Select a category
          </label>

          <div v-if="isLoadingCategories" class="deeplink-loading-inline">
            <i class="fa-solid fa-spinner fa-spin"></i>
            <span>Loading categories…</span>
          </div>

          <div v-else-if="categories.length === 0" class="deeplink-empty">
            <span>No categories found for this course.</span>
          </div>

          <div v-else class="deeplink-list">
            <button
              v-for="cat in categories"
              :key="cat._id"
              class="deeplink-item"
              :class="{ selected: selectedCategoryId === cat._id }"
              type="button"
              @click="selectedCategoryId = cat._id"
            >
              <span class="deeplink-item-name">{{ cat.name }}</span>
              <span class="deeplink-item-desc">
                {{ cat.agentCount }} {{ cat.agentCount === 1 ? 'item' : 'items' }}
              </span>
              <i
                v-if="selectedCategoryId === cat._id"
                class="fa-solid fa-circle-check deeplink-check"
              ></i>
            </button>
          </div>
        </div>

        <div class="deeplink-footer">
          <button
            class="deeplink-submit-btn"
            :disabled="!canSubmit || isSubmitting"
            @click="handleSubmit"
          >
            <i v-if="isSubmitting" class="fa-solid fa-spinner fa-spin"></i>
            <i v-else class="fa-solid fa-check"></i>
            Save &amp; Return to Moodle
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  getDeepLinkData,
  getDeepLinkAgents,
  getDeepLinkCategories,
  submitDeepLink,
  getLtiBase,
  type DeepLinkData,
  type DeepLinkAgent,
  type DeepLinkCourse,
  type DeepLinkCategory,
} from '../api';

const DEBOUNCE_SEARCH_MS = 300;

export default defineComponent({
  name: 'LtiDeepLinkView',
  props: {
    /**
     * Set to `false` to hide the category-binding toggle when your app
     * doesn't implement the adapter's category methods.
     */
    categorySupported: { type: Boolean, default: true },
  },
  setup(props) {
    const route = useRoute();
    const ltik = computed(() => String(route.query.ltik ?? '').trim());
    const createdAgentId = computed(() => String(route.query.createdAgentId ?? '').trim());

    const pageData = ref<DeepLinkData | null>(null);
    const isLoadingData = ref(true);
    const errorMessage = ref('');

    const selectedCourseId = ref('');
    const bindingType = ref<'agent' | 'category'>('agent');
    const selectedAgentId = ref('');
    const selectedCategoryId = ref('');
    const agents = ref<DeepLinkAgent[]>([]);
    const categories = ref<DeepLinkCategory[]>([]);
    const isLoadingAgents = ref(false);
    const isLoadingCategories = ref(false);
    const publicSearchQuery = ref('');
    const isSubmitting = ref(false);

    let searchTimer: ReturnType<typeof setTimeout> | null = null;

    const courseAgents = computed(() => agents.value.filter((a) => a.source === 'course'));
    const publicAgents = computed(() => agents.value.filter((a) => a.source === 'public'));

    const canSubmit = computed(() => {
      if (!selectedCourseId.value) return false;
      if (bindingType.value === 'category') return !!selectedCategoryId.value;
      return !!selectedAgentId.value;
    });

    function formatCourseLabel(c: DeepLinkCourse): string {
      const parts: string[] = [];
      if (c.course_id) parts.push(`[${c.course_id}]`);
      parts.push(c.name);
      const meta = [c.code, c.semester, c.year, c.section].filter(Boolean);
      if (meta.length) parts.push(`(${meta.join(' ')})`);
      return parts.join(' ');
    }

    async function loadAgents() {
      if (!selectedCourseId.value || !ltik.value) return;
      isLoadingAgents.value = true;
      selectedAgentId.value = '';
      try {
        agents.value = await getDeepLinkAgents(
          ltik.value,
          selectedCourseId.value,
          publicSearchQuery.value
        );
        if (createdAgentId.value) {
          const match = agents.value.find((a) => a._id === createdAgentId.value);
          if (match) selectedAgentId.value = match._id;
        }
      } catch {
        agents.value = [];
        errorMessage.value = 'Failed to load resources.';
      } finally {
        isLoadingAgents.value = false;
      }
    }

    async function loadCategories() {
      if (!props.categorySupported) return;
      if (!selectedCourseId.value || !ltik.value) return;
      isLoadingCategories.value = true;
      selectedCategoryId.value = '';
      try {
        categories.value = await getDeepLinkCategories(ltik.value, selectedCourseId.value);
      } catch {
        categories.value = [];
      } finally {
        isLoadingCategories.value = false;
      }
    }

    function onCourseChange() {
      publicSearchQuery.value = '';
      selectedAgentId.value = '';
      selectedCategoryId.value = '';
      loadAgents();
      loadCategories();
    }

    function onSearchInput() {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadAgents(), DEBOUNCE_SEARCH_MS);
    }

    watch(bindingType, () => {
      selectedAgentId.value = '';
      selectedCategoryId.value = '';
    });

    async function handleSubmit() {
      if (!ltik.value || !selectedCourseId.value) return;
      isSubmitting.value = true;
      errorMessage.value = '';
      try {
        const result = await submitDeepLink(
          ltik.value,
          selectedCourseId.value,
          bindingType.value === 'agent' ? selectedAgentId.value : undefined,
          bindingType.value === 'category' ? selectedCategoryId.value : undefined
        );

        if (result.jwt && result.returnUrl) {
          const sep = result.returnUrl.includes('?') ? '&' : '?';
          window.location.assign(
            `${result.returnUrl}${sep}JWT=${encodeURIComponent(result.jwt)}`
          );
        } else {
          // Popup reconfigure flow — return to the teacher manage page.
          const manageUrl = `${getLtiBase()}/launch/manage?ltik=${encodeURIComponent(ltik.value)}&updated=1`;
          window.location.assign(manageUrl);
        }
      } catch (e: any) {
        errorMessage.value = e?.message || 'Failed to save selection.';
      } finally {
        isSubmitting.value = false;
      }
    }

    onMounted(async () => {
      if (!ltik.value) {
        errorMessage.value = 'Missing LTI context token.';
        isLoadingData.value = false;
        return;
      }
      try {
        pageData.value = await getDeepLinkData(ltik.value);
        if (pageData.value.error) {
          errorMessage.value = pageData.value.error;
        }
        if (pageData.value.preselectedCourseId) {
          selectedCourseId.value = pageData.value.preselectedCourseId;
          await Promise.all([loadAgents(), loadCategories()]);
        }
      } catch (e: any) {
        errorMessage.value = e?.message || 'Failed to load configuration data.';
      } finally {
        isLoadingData.value = false;
      }
    });

    return {
      pageData,
      isLoadingData,
      errorMessage,
      selectedCourseId,
      bindingType,
      selectedAgentId,
      selectedCategoryId,
      agents,
      categories,
      isLoadingAgents,
      isLoadingCategories,
      publicSearchQuery,
      isSubmitting,
      courseAgents,
      publicAgents,
      canSubmit,
      formatCourseLabel,
      onCourseChange,
      onSearchInput,
      handleSubmit,
    };
  },
});
</script>

<style scoped>
.deeplink-page {
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 32px 16px;
  background: #f9fafb;
  font-family: system-ui, -apple-system, sans-serif;
}
.deeplink-card {
  width: 100%;
  max-width: 680px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
  border: 1px solid #e5e7eb;
  overflow: hidden;
}
.deeplink-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 24px 28px;
  background: linear-gradient(135deg, #6dbc2f 0%, #5aa025 100%);
  color: #fff;
}
.deeplink-header-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
}
.deeplink-title {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
}
.deeplink-subtitle {
  margin: 4px 0 0;
  font-size: 0.82rem;
  opacity: 0.85;
}
.deeplink-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 28px;
  background: #fef2f2;
  color: #dc2626;
  font-size: 0.88rem;
  border-bottom: 1px solid #fecaca;
}
.deeplink-loading,
.deeplink-loading-inline {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px 0;
  color: #9ca3af;
  font-size: 0.95rem;
}
.deeplink-loading {
  flex-direction: column;
  padding: 56px 28px;
}
.deeplink-loading-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
}
.deeplink-section {
  padding: 18px 28px;
  border-bottom: 1px solid #f3f4f6;
}
.deeplink-section:last-of-type {
  border-bottom: none;
}
.deeplink-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 8px;
  color: #374151;
}
.deeplink-label i {
  font-size: 0.85rem;
  color: #6dbc2f;
}
.deeplink-select {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 0.9rem;
  background: #fff;
}
.deeplink-select:focus {
  outline: none;
  border-color: #6dbc2f;
  box-shadow: 0 0 0 3px rgba(109, 188, 47, 0.1);
}
.deeplink-hint {
  margin: 6px 0 0;
  font-size: 0.78rem;
  color: #9ca3af;
}
.deeplink-toggle {
  display: flex;
  background: #f3f4f6;
  border-radius: 12px;
  padding: 3px;
  gap: 3px;
}
.deeplink-toggle-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #6b7280;
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}
.deeplink-toggle-btn.active {
  background: #6dbc2f;
  color: #fff;
  font-weight: 600;
}
.deeplink-search-row {
  position: relative;
  margin-bottom: 12px;
}
.deeplink-search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
  pointer-events: none;
}
.deeplink-search-input {
  width: 100%;
  padding: 10px 12px 10px 36px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 0.88rem;
  box-sizing: border-box;
}
.deeplink-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 0;
  color: #9ca3af;
  font-size: 0.88rem;
}
.deeplink-list {
  max-height: 360px;
  overflow-y: auto;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}
.deeplink-group-header {
  padding: 8px 14px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #9ca3af;
  background: #f9fafb;
  border-bottom: 1px solid #f3f4f6;
  position: sticky;
  top: 0;
}
.deeplink-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: none;
  border-bottom: 1px solid #f3f4f6;
  background: #fff;
  cursor: pointer;
  text-align: left;
}
.deeplink-item:hover {
  background: #f9fafb;
}
.deeplink-item.selected {
  background: rgba(109, 188, 47, 0.05);
  border-left: 3px solid #6dbc2f;
  padding-left: 11px;
}
.deeplink-item-name {
  flex: 1;
  font-weight: 600;
  font-size: 0.9rem;
  color: #1f2937;
}
.deeplink-item-desc {
  font-size: 0.78rem;
  color: #9ca3af;
}
.deeplink-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 100px;
}
.deeplink-badge.public {
  background: #eff6ff;
  color: #2563eb;
}
.deeplink-check {
  color: #6dbc2f;
  font-size: 1.15rem;
}
.deeplink-footer {
  padding: 16px 28px 24px;
  border-top: 1px solid #f3f4f6;
}
.deeplink-submit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 28px;
  background: #6dbc2f;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
}
.deeplink-submit-btn:hover:not(:disabled) {
  background: #5aa025;
}
.deeplink-submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
