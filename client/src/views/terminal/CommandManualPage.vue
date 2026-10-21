<template>
  <div class="page-container manual-page">
    <el-card shadow="hover" class="manual-card">
      <CommandManual mode="page" />
    </el-card>
  </div>
</template>

<script setup>
import CommandManual from '../../components/terminal/CommandManual.vue'
</script>

<style scoped>
.manual-page { height: calc(100vh - 56px - 40px); }
.manual-card { height: 100%; }
.manual-card :deep(.el-card__body) { height: calc(100% - 40px); }
</style>
