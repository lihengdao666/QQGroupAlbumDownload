<template>
  <div
    style="display: flex; flex: 1 1 0; flex-direction: column; overflow: hidden"
  >
    <el-scrollbar height="100%">
      <el-table
        ref="multipleTableRef"
        @selection-change="handleSelectionChange"
        :data="props.qqAlbumList"
        style="width: 100%; padding: 20px 0px; box-sizing: border-box"
      >
        <el-table-column align="center" type="selection" />
        <el-table-column align="center" prop="title" label="名称" />
        <el-table-column align="center" prop="num" label="数量" />
        <el-table-column align="center" label="上传时间">
          <template #default="scope">
            {{ formatTime(scope.row.uploadTime) }}
          </template>
        </el-table-column>
      </el-table>
    </el-scrollbar>
  </div>

  <div>
    <el-row>
      <el-col :span="12" style="padding: 0% 5%">
        <el-button @click="startDownload" style="width: 100%" type="primary"
          >开始下载</el-button
        >
      </el-col>
      <el-col :span="12" style="padding: 0% 5%">
        <el-button @click="backPage" style="width: 100%" type="warning"
          >返回上级</el-button
        >
      </el-col>
    </el-row>
  </div>
</template>
<script lang="ts" setup>
import { defineProps, defineEmits, toRaw, ref, onMounted } from "vue";
import type { TableInstance } from "element-plus";
// eslint-disable-next-line vue/no-setup-props-destructure
const props = defineProps({
  qqAlbumList: {
    type: Array,
    required: true,
  },
  selectAlbumList: {
    type: Array,
    required: true,
  },
});
const multipleTableRef = ref<TableInstance>();
onMounted(() => {
  props.selectAlbumList.forEach((item) => {
      multipleTableRef.value?.toggleRowSelection(
        item,
        undefined,
        undefined
      )
    })
});
const emit = defineEmits(["backPage", "setSelectAlbumList", "startDownload"]);
const formatTime = (ts: number | null | undefined) => {
  if (!ts) return "-";
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const backPage = () => {
  emit("backPage");
};
const handleSelectionChange = (val: any[]) => {
  emit("setSelectAlbumList", toRaw(val));
};
const startDownload = () => {
  if (props.selectAlbumList.length == 0) {
    ElMessage.error("请选择下载相册!");
    return;
  }
  emit("startDownload");
};
</script>
