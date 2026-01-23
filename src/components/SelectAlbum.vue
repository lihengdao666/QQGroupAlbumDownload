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

interface Album {
  title: string;
  num: number;
}

// eslint-disable-next-line vue/no-setup-props-destructure
const props = defineProps({
  qqAlbumList: {
    type: Array as PropType<Album[]>,
    required: true,
  },
  selectAlbumList: {
    type: Array as PropType<Album[]>,
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
const backPage = () => {
  emit("backPage");
};
const handleSelectionChange = (val: Album[]) => {
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